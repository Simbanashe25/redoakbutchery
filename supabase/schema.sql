create table if not exists public.butcher_shop_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'staff',
  created_at timestamptz not null default now()
);

alter table public.butcher_shop_members
  add column if not exists role text not null default 'staff';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'butcher_shop_members_role_check'
      and conrelid = 'public.butcher_shop_members'::regclass
  ) then
    alter table public.butcher_shop_members
      add constraint butcher_shop_members_role_check check (role in ('admin', 'staff'));
  end if;
end
$$;

create table if not exists public.butcher_shop_state (
  id text primary key check (id = 'main'),
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

create table if not exists public.butcher_categories (
  category text primary key,
  sort_order integer not null
);

create table if not exists public.butcher_products (
  product_id text primary key,
  sort_order integer not null,
  name text not null,
  category text not null,
  price numeric(12, 2) not null check (price > 0),
  record jsonb not null check (jsonb_typeof(record) = 'object')
);

create index if not exists butcher_products_category_order_idx
  on public.butcher_products (category, sort_order);

create table if not exists public.butcher_customers (
  customer_id text primary key,
  sort_order integer not null,
  name text not null,
  customer_type text not null,
  phone text not null default '',
  email text not null default '',
  record jsonb not null check (jsonb_typeof(record) = 'object')
);

create index if not exists butcher_customers_name_idx
  on public.butcher_customers (lower(name));

create table if not exists public.butcher_payment_methods (
  method text primary key,
  sort_order integer not null
);

create table if not exists public.butcher_shop_settings (
  id text primary key check (id = 'main'),
  settings jsonb not null check (jsonb_typeof(settings) = 'object')
);

create table if not exists public.butcher_stock_balances (
  product_id text primary key,
  quantity numeric(14, 3) not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.butcher_sales (
  sale_id text primary key,
  sort_order integer not null,
  receipt_number text not null,
  created_at_ms bigint not null,
  customer_name text not null,
  total numeric(14, 2) not null check (total >= 0),
  record jsonb not null check (jsonb_typeof(record) = 'object')
);

create index if not exists butcher_sales_created_idx
  on public.butcher_sales (created_at_ms desc);

create index if not exists butcher_sales_receipt_number_idx
  on public.butcher_sales (receipt_number);

create table if not exists public.butcher_held_orders (
  order_id text primary key,
  sort_order integer not null,
  held_at text not null,
  record jsonb not null check (jsonb_typeof(record) = 'object')
);

create table if not exists public.butcher_expenses (
  expense_id text primary key,
  sort_order integer not null,
  created_at_ms bigint not null,
  category text not null,
  description text not null,
  amount numeric(14, 2) not null check (amount > 0),
  method text not null,
  record jsonb not null check (jsonb_typeof(record) = 'object')
);

create index if not exists butcher_expenses_created_idx
  on public.butcher_expenses (created_at_ms desc);

create table if not exists public.butcher_day_end_reports (
  report_id text primary key,
  sort_order integer not null,
  closed_at text not null,
  closed_by text not null,
  record jsonb not null check (jsonb_typeof(record) = 'object')
);

create table if not exists public.butcher_inventory_movements (
  movement_id text primary key,
  sort_order integer not null,
  product_id text not null,
  product_name text not null,
  movement_type text not null,
  quantity_change numeric(14, 3) not null,
  reference text not null default '',
  operator_name text not null default '',
  record jsonb not null check (jsonb_typeof(record) = 'object')
);

create index if not exists butcher_inventory_product_order_idx
  on public.butcher_inventory_movements (product_id, sort_order);

create table if not exists public.butcher_stock_receipts (
  receipt_id text primary key,
  sort_order integer not null,
  created_at_ms bigint not null,
  product_name text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost numeric(14, 2) not null check (unit_cost >= 0),
  supplier text not null default '',
  record jsonb not null check (jsonb_typeof(record) = 'object')
);

create index if not exists butcher_stock_receipts_created_idx
  on public.butcher_stock_receipts (created_at_ms desc);

create table if not exists public.butcher_processing_batches (
  batch_id text primary key,
  sort_order integer not null,
  batch_number text not null,
  processed_at text not null,
  operator_name text not null default '',
  total_input numeric(14, 3) not null check (total_input >= 0),
  total_output numeric(14, 3) not null check (total_output >= 0),
  record jsonb not null check (jsonb_typeof(record) = 'object')
);

create table if not exists public.butcher_stocktakes (
  stocktake_id text primary key,
  sort_order integer not null,
  product_id text not null,
  expected_quantity numeric(14, 3) not null check (expected_quantity >= 0),
  counted_quantity numeric(14, 3) not null check (counted_quantity >= 0),
  variance numeric(14, 3) not null,
  counted_by text not null default '',
  record jsonb not null check (jsonb_typeof(record) = 'object')
);

create table if not exists public.butcher_day_closures (
  id text primary key check (id = 'main'),
  closed_sale_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(closed_sale_ids) = 'array'),
  closed_refund_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(closed_refund_ids) = 'array'),
  closed_expense_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(closed_expense_ids) = 'array')
);

alter table public.butcher_shop_members enable row level security;
alter table public.butcher_shop_state enable row level security;
alter table public.butcher_categories enable row level security;
alter table public.butcher_products enable row level security;
alter table public.butcher_customers enable row level security;
alter table public.butcher_payment_methods enable row level security;
alter table public.butcher_shop_settings enable row level security;
alter table public.butcher_stock_balances enable row level security;
alter table public.butcher_sales enable row level security;
alter table public.butcher_held_orders enable row level security;
alter table public.butcher_expenses enable row level security;
alter table public.butcher_day_end_reports enable row level security;
alter table public.butcher_inventory_movements enable row level security;
alter table public.butcher_stock_receipts enable row level security;
alter table public.butcher_processing_batches enable row level security;
alter table public.butcher_stocktakes enable row level security;
alter table public.butcher_day_closures enable row level security;

revoke all on public.butcher_shop_members, public.butcher_shop_state,
  public.butcher_categories, public.butcher_products, public.butcher_customers,
  public.butcher_payment_methods, public.butcher_shop_settings,
  public.butcher_stock_balances, public.butcher_sales, public.butcher_held_orders,
  public.butcher_expenses, public.butcher_day_end_reports,
  public.butcher_inventory_movements, public.butcher_stock_receipts,
  public.butcher_processing_batches, public.butcher_stocktakes,
  public.butcher_day_closures
from public, anon, authenticated;

grant select on public.butcher_shop_members to authenticated;
grant select on public.butcher_shop_state to authenticated;

drop policy if exists "Staff can read their own shop membership" on public.butcher_shop_members;
create policy "Staff can read their own shop membership"
  on public.butcher_shop_members
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "Shop members can read sync revision" on public.butcher_shop_state;
drop policy if exists "Authenticated staff can read shop state" on public.butcher_shop_state;
create policy "Shop members can read sync revision"
  on public.butcher_shop_state
  for select
  to authenticated
  using (
    exists (
      select 1 from public.butcher_shop_members where user_id = auth.uid()
    )
  );

create or replace function public.load_butcher_shop_state()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  shop_data jsonb;
  shop_revision bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to read shop data.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.butcher_shop_members where user_id = auth.uid()
  ) then
    raise exception 'This account is not authorized for this shop.'
      using errcode = '42501';
  end if;

  select revision into shop_revision
    from public.butcher_shop_state
    where id = 'main';
  shop_revision := coalesce(shop_revision, 0);

  select jsonb_build_object(
    'products', coalesce((select jsonb_agg(record order by sort_order) from public.butcher_products), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(to_jsonb(category) order by sort_order) from public.butcher_categories), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(record order by sort_order) from public.butcher_customers), '[]'::jsonb),
    'paymentMethods', coalesce((select jsonb_agg(to_jsonb(method) order by sort_order) from public.butcher_payment_methods), '[]'::jsonb),
    'closedDaySaleIds', coalesce((select closed_sale_ids from public.butcher_day_closures where id = 'main'), '[]'::jsonb),
    'closedDayRefundIds', coalesce((select closed_refund_ids from public.butcher_day_closures where id = 'main'), '[]'::jsonb),
    'expenses', coalesce((select jsonb_agg(record order by sort_order) from public.butcher_expenses), '[]'::jsonb),
    'closedDayExpenseIds', coalesce((select closed_expense_ids from public.butcher_day_closures where id = 'main'), '[]'::jsonb),
    'dayEndReports', coalesce((select jsonb_agg(record order by sort_order) from public.butcher_day_end_reports), '[]'::jsonb),
    'sales', coalesce((select jsonb_agg(record order by sort_order) from public.butcher_sales), '[]'::jsonb),
    'heldOrders', coalesce((select jsonb_agg(record order by sort_order) from public.butcher_held_orders), '[]'::jsonb),
    'companyDetails', coalesce((select settings from public.butcher_shop_settings where id = 'main'), '{}'::jsonb),
    'stock', coalesce((select jsonb_object_agg(product_id, quantity) from public.butcher_stock_balances), '{}'::jsonb),
    'inventoryMovements', coalesce((select jsonb_agg(record order by sort_order) from public.butcher_inventory_movements), '[]'::jsonb),
    'stockReceipts', coalesce((select jsonb_agg(record order by sort_order) from public.butcher_stock_receipts), '[]'::jsonb),
    'processingHistory', coalesce((select jsonb_agg(record order by sort_order) from public.butcher_processing_batches), '[]'::jsonb),
    'stocktakeHistory', coalesce((select jsonb_agg(record order by sort_order) from public.butcher_stocktakes), '[]'::jsonb)
  ) into shop_data;

  return jsonb_build_object('data', shop_data, 'revision', shop_revision);
end;
$$;

create or replace function public.save_butcher_shop_state(
  p_data jsonb,
  p_expected_revision bigint
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_revision bigint;
  item jsonb;
  item_index integer;
  item_id text;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required to save shop data.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.butcher_shop_members where user_id = auth.uid()
  ) then
    raise exception 'This account is not authorized for this shop.'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_data) <> 'object' then
    raise exception 'Shop data must be a JSON object.'
      using errcode = '22023';
  end if;

  insert into public.butcher_shop_state (id, revision, updated_by)
  values ('main', 0, auth.uid())
  on conflict (id) do nothing;

  select revision into current_revision
    from public.butcher_shop_state
    where id = 'main'
    for update;

  if current_revision <> p_expected_revision then
    raise exception 'Shop data changed in another session. Reload before saving again.'
      using errcode = '40001';
  end if;

  if jsonb_typeof(coalesce(p_data->'products', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'categories', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'customers', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'paymentMethods', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'sales', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'heldOrders', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'expenses', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'dayEndReports', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'inventoryMovements', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'stockReceipts', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'processingHistory', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'stocktakeHistory', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_data->'stock', '{}'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_data->'companyDetails', '{}'::jsonb)) <> 'object' then
    raise exception 'Shop data contains an invalid collection.'
      using errcode = '22023';
  end if;

  delete from public.butcher_categories where true;
  delete from public.butcher_products where true;
  delete from public.butcher_customers where true;
  delete from public.butcher_payment_methods where true;
  delete from public.butcher_shop_settings where true;
  delete from public.butcher_stock_balances where true;
  delete from public.butcher_sales where true;
  delete from public.butcher_held_orders where true;
  delete from public.butcher_expenses where true;
  delete from public.butcher_day_end_reports where true;
  delete from public.butcher_inventory_movements where true;
  delete from public.butcher_stock_receipts where true;
  delete from public.butcher_processing_batches where true;
  delete from public.butcher_stocktakes where true;

  for item, item_index in
    select value, ordinality::integer
      from jsonb_array_elements(coalesce(p_data->'categories', '[]'::jsonb)) with ordinality
  loop
    insert into public.butcher_categories (category, sort_order)
    values (item #>> '{}', item_index);
  end loop;

  for item, item_index in
    select value, ordinality::integer
      from jsonb_array_elements(coalesce(p_data->'products', '[]'::jsonb)) with ordinality
  loop
    item_id := item->>'id';
    if item_id is null or item->>'name' is null or item->>'category' is null then
      raise exception 'Every product must include an id, name, and category.'
        using errcode = '22023';
    end if;
    insert into public.butcher_products (product_id, sort_order, name, category, price, record)
    values (item_id, item_index, item->>'name', item->>'category', (item->>'price')::numeric, item);
  end loop;

  for item, item_index in
    select value, ordinality::integer
      from jsonb_array_elements(coalesce(p_data->'customers', '[]'::jsonb)) with ordinality
  loop
    item_id := item->>'id';
    if item_id is null or item->>'name' is null then
      raise exception 'Every customer must include an id and name.'
        using errcode = '22023';
    end if;
    insert into public.butcher_customers (customer_id, sort_order, name, customer_type, phone, email, record)
    values (item_id, item_index, item->>'name', coalesce(item->>'type', 'person'),
      coalesce(item->>'phone', ''), coalesce(item->>'email', ''), item);
  end loop;

  for item, item_index in
    select value, ordinality::integer
      from jsonb_array_elements(coalesce(p_data->'paymentMethods', '[]'::jsonb)) with ordinality
  loop
    insert into public.butcher_payment_methods (method, sort_order)
    values (item #>> '{}', item_index);
  end loop;

  insert into public.butcher_shop_settings (id, settings)
  values ('main', coalesce(p_data->'companyDetails', '{}'::jsonb));

  for item_id, item in
    select key, value from jsonb_each(coalesce(p_data->'stock', '{}'::jsonb))
  loop
    if item::text !~ '^-?[0-9]+([.][0-9]+)?$' or (item #>> '{}')::numeric < 0 then
      raise exception 'Stock quantities must be non-negative numbers.'
        using errcode = '22023';
    end if;
    insert into public.butcher_stock_balances (product_id, quantity)
    values (item_id, (item #>> '{}')::numeric);
  end loop;

  for item, item_index in
    select value, ordinality::integer
      from jsonb_array_elements(coalesce(p_data->'sales', '[]'::jsonb)) with ordinality
  loop
    item_id := item->>'id';
    if item_id is null then
      raise exception 'Every sale must include an id.'
        using errcode = '22023';
    end if;
    insert into public.butcher_sales (sale_id, sort_order, receipt_number, created_at_ms, customer_name, total, record)
    values (item_id, item_index, coalesce(item->>'number', item_id),
      coalesce((item->>'createdAtMs')::bigint, 0), coalesce(item->>'customer', 'Cash Customer'),
      coalesce((item->>'total')::numeric, 0), item);
  end loop;

  for item, item_index in
    select value, ordinality::integer
      from jsonb_array_elements(coalesce(p_data->'heldOrders', '[]'::jsonb)) with ordinality
  loop
    item_id := item->>'id';
    if item_id is null then
      raise exception 'Every held order must include an id.'
        using errcode = '22023';
    end if;
    insert into public.butcher_held_orders (order_id, sort_order, held_at, record)
    values (item_id, item_index, coalesce(item->>'heldAt', ''), item);
  end loop;

  for item, item_index in
    select value, ordinality::integer
      from jsonb_array_elements(coalesce(p_data->'expenses', '[]'::jsonb)) with ordinality
  loop
    item_id := item->>'id';
    if item_id is null then
      raise exception 'Every expense must include an id.'
        using errcode = '22023';
    end if;
    insert into public.butcher_expenses (expense_id, sort_order, created_at_ms, category, description, amount, method, record)
    values (item_id, item_index, coalesce((item->>'createdAtMs')::bigint, 0),
      coalesce(item->>'category', 'Other'), coalesce(item->>'description', ''),
      (item->>'amount')::numeric, coalesce(item->>'method', 'CASH'), item);
  end loop;

  for item, item_index in
    select value, ordinality::integer
      from jsonb_array_elements(coalesce(p_data->'dayEndReports', '[]'::jsonb)) with ordinality
  loop
    item_id := item->>'id';
    if item_id is null then
      raise exception 'Every day-end report must include an id.'
        using errcode = '22023';
    end if;
    insert into public.butcher_day_end_reports (report_id, sort_order, closed_at, closed_by, record)
    values (item_id, item_index, coalesce(item->>'closedAt', ''),
      coalesce(item->>'closedBy', ''), item);
  end loop;

  for item, item_index in
    select value, ordinality::integer
      from jsonb_array_elements(coalesce(p_data->'inventoryMovements', '[]'::jsonb)) with ordinality
  loop
    item_id := item->>'id';
    if item_id is null then
      raise exception 'Every inventory movement must include an id.'
        using errcode = '22023';
    end if;
    insert into public.butcher_inventory_movements (
      movement_id, sort_order, product_id, product_name, movement_type,
      quantity_change, reference, operator_name, record
    )
    values (item_id, item_index, coalesce(item->>'productId', ''),
      coalesce(item->>'product', ''), coalesce(item->>'type', ''),
      (item->>'quantity')::numeric, coalesce(item->>'reference', ''),
      coalesce(item->>'operator', ''), item);
  end loop;

  for item, item_index in
    select value, ordinality::integer
      from jsonb_array_elements(coalesce(p_data->'stockReceipts', '[]'::jsonb)) with ordinality
  loop
    item_id := item->>'id';
    if item_id is null then
      raise exception 'Every stock receipt must include an id.'
        using errcode = '22023';
    end if;
    insert into public.butcher_stock_receipts (
      receipt_id, sort_order, created_at_ms, product_name,
      quantity, unit_cost, supplier, record
    )
    values (item_id, item_index,
      coalesce((item->>'createdAtMs')::bigint, 0),
      coalesce(item->>'product', ''), (item->>'quantity')::numeric,
      (item->>'unitCost')::numeric, coalesce(item->>'supplier', ''), item);
  end loop;

  for item, item_index in
    select value, ordinality::integer
      from jsonb_array_elements(coalesce(p_data->'processingHistory', '[]'::jsonb)) with ordinality
  loop
    item_id := item->>'id';
    if item_id is null then
      raise exception 'Every processing batch must include an id.'
        using errcode = '22023';
    end if;
    insert into public.butcher_processing_batches (
      batch_id, sort_order, batch_number, processed_at, operator_name,
      total_input, total_output, record
    )
    values (item_id, item_index, coalesce(item->>'number', ''),
      coalesce(item->>'processedAt', ''), coalesce(item->>'operator', ''),
      coalesce((item->>'totalInput')::numeric, 0),
      coalesce((item->>'totalOutput')::numeric, 0), item);
  end loop;

  for item, item_index in
    select value, ordinality::integer
      from jsonb_array_elements(coalesce(p_data->'stocktakeHistory', '[]'::jsonb)) with ordinality
  loop
    item_id := item->>'id';
    if item_id is null then
      raise exception 'Every stocktake must include an id.'
        using errcode = '22023';
    end if;
    insert into public.butcher_stocktakes (
      stocktake_id, sort_order, product_id, expected_quantity,
      counted_quantity, variance, counted_by, record
    )
    values (item_id, item_index, coalesce(item->>'productId', ''),
      (item->>'expected')::numeric, (item->>'counted')::numeric,
      (item->>'variance')::numeric, coalesce(item->>'operator', ''), item);
  end loop;

  insert into public.butcher_day_closures (
    id, closed_sale_ids, closed_refund_ids, closed_expense_ids
  )
  values (
    'main',
    coalesce(p_data->'closedDaySaleIds', '[]'::jsonb),
    coalesce(p_data->'closedDayRefundIds', '[]'::jsonb),
    coalesce(p_data->'closedDayExpenseIds', '[]'::jsonb)
  )
  on conflict (id) do update set
    closed_sale_ids = excluded.closed_sale_ids,
    closed_refund_ids = excluded.closed_refund_ids,
    closed_expense_ids = excluded.closed_expense_ids;

  update public.butcher_shop_state
    set revision = current_revision + 1,
        updated_at = now(),
        updated_by = auth.uid()
    where id = 'main';

  return current_revision + 1;
end;
$$;

revoke all on function public.load_butcher_shop_state() from public, anon;
grant execute on function public.load_butcher_shop_state() to authenticated;
revoke all on function public.save_butcher_shop_state(jsonb, bigint) from public, anon;
grant execute on function public.save_butcher_shop_state(jsonb, bigint) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.butcher_shop_state;
exception
  when duplicate_object then null;
end
$$;
