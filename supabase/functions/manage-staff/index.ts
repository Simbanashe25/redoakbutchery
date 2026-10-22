import { createClient } from "https://esm.sh/@supabase/supabase-js@2.118.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return respond(500, { error: "Staff management is not configured on the server." });
  }
  if (!authorization) return respond(401, { error: "Sign in as an authorized shop administrator." });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return respond(401, { error: "Your session is invalid. Sign in again." });

    const { data: membership, error: membershipError } = await adminClient
      .from("butcher_shop_members")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (membership?.role !== "admin") {
      return respond(403, { error: "Only a shop administrator can manage staff accounts." });
    }

    const body = await request.json();
    if (body.action === "list") {
      const { data: members, error: membersError } = await adminClient
        .from("butcher_shop_members")
        .select("user_id, role, created_at")
        .order("created_at");
      if (membersError) throw membersError;

      const users = [];
      for (let page = 1; ; page += 1) {
        const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        users.push(...data.users);
        if (data.users.length < 1000) break;
      }
      const usersById = new Map(users.map((account) => [account.id, account]));
      const staff = (members ?? []).map((member) => ({
        userId: member.user_id,
        email: usersById.get(member.user_id)?.email ?? "Unknown email",
        role: member.role,
        createdAt: member.created_at,
      }));
      return respond(200, { staff });
    }

    if (body.action === "create") {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return respond(400, { error: "Enter a valid staff email address." });
      }
      if (password.length < 8) {
        return respond(400, { error: "Staff passwords must be at least 8 characters." });
      }

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createError) return respond(400, { error: createError.message });
      if (!created.user) return respond(500, { error: "Supabase did not return the new user account." });

      const { error: membershipInsertError } = await adminClient
        .from("butcher_shop_members")
        .insert({ user_id: created.user.id, role: "staff" });
      if (membershipInsertError) {
        const { error: rollbackError } = await adminClient.auth.admin.deleteUser(created.user.id);
        if (rollbackError) {
          throw new Error(`Staff access could not be added, and the new Auth account could not be rolled back: ${rollbackError.message}`);
        }
        throw membershipInsertError;
      }
      return respond(201, {
        staff: {
          userId: created.user.id,
          email: created.user.email,
          role: "staff",
          createdAt: created.user.created_at,
        },
      });
    }

    return respond(400, { error: "Choose a valid staff management action." });
  } catch (error) {
    console.error("Staff management failed:", error);
    return respond(500, { error: error instanceof Error ? error.message : "Staff management failed." });
  }
});
