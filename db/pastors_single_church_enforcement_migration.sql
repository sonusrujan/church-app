-- Migration: enforce strict single-church assignment for pastors
-- Run this for existing databases.

create unique index if not exists pastors_phone_unique
  on pastors(phone_number);

create unique index if not exists pastors_email_unique
  on pastors(lower(email))
  where email is not null;
