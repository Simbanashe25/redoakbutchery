# Supabase setup

`schema.sql` creates the database for the complete POS. It separates categories, products, customers, payment methods, company settings, stock balances, sales, held orders, expenses, day-end reports, inventory movements, receipts, processing batches, stocktakes, and day-close markers into dedicated tables. Sale line items, payments, refunds, and processing input/output details are kept with their owning records so the app can round-trip those complete workflows. The app reads and writes these tables through transactional, revision-checked database functions.

1. In the Supabase dashboard for this project, open **SQL Editor**, paste the complete `schema.sql`, and run it. This adds the `role` column to existing shop membership records.
2. In **SQL Editor**, authorize your existing Supabase Auth account as the shop administrator. Replace the email with your account’s email:
   ```sql
   insert into public.butcher_shop_members (user_id, role)
   select id, 'admin' from auth.users
   where lower(email) = lower('YOUR_ADMIN_EMAIL')
   on conflict (user_id) do update set role = 'admin';
   ```
3. Link the Supabase CLI to this project and deploy the staff-management Edge Function:
   ```text
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy manage-staff
   ```
   The function uses Supabase’s server-side `SUPABASE_SERVICE_ROLE_KEY` secret. Never copy that key into the app or `.env.local`.
4. Sign out and back in with the admin account. In **Advanced → Users**, create staff email/password accounts. New users are automatically added to this shop as staff. Passwords are sent directly to Supabase Auth and are not stored in the shop database.
5. Start or restart Vite after setting `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the ignored `.env.local` file. The new database starts with no shop records; create categories, products, and payment methods in Advanced tools before processing sales.

Only accounts listed in `butcher_shop_members` can access shop data. The Edge Function verifies the signed-in user's admin role before listing or creating accounts; the service-role key remains server-side. Authorized staff share the same shop data. Row-level security blocks direct access to operational tables; reads and writes use membership-checked database functions. Concurrent edits are synchronized when possible, and stale unsaved changes are blocked instead of silently overwriting newer data. The existing Advanced PIN is only a client-side demo gate, not a staff role or database permission.

If you already ran the previous single-document schema and populated it with real records, stop before rerunning this schema: its old JSON document is not automatically converted to the new tables. Export/back up that data and migrate it before switching the app.

Never put a Supabase service-role key in a Vite environment variable or browser code. Only use the project’s publishable key in `.env.local`.
