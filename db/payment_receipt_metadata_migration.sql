alter table public.payments
  add column if not exists receipt_number text,
  add column if not exists receipt_generated_at timestamptz;

create index if not exists payments_member_payment_date_idx
  on public.payments(member_id, payment_date desc);

create index if not exists payments_receipt_number_idx
  on public.payments(receipt_number);
