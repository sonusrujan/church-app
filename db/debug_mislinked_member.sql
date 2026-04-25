-- ============================================================
-- DIAGNOSTIC: Find how phone 9160825903 got linked to Solomon Raju
-- Run these against production DB
-- ============================================================

-- 1. Find the user who logged in with 9160825903
SELECT id, email, phone_number, full_name, role, church_id, auth_user_id, created_at
FROM users
WHERE phone_number = '+919160825903';

-- 2. Find the member record for P Solomon Raju (phone 9703322382)
SELECT id, user_id, full_name, email, phone_number, church_id, created_at
FROM members
WHERE phone_number = '+919703322382';

-- 3. Find ALL members linked to the user who logged in with 9160825903
SELECT m.id, m.user_id, m.full_name, m.email, m.phone_number, m.church_id
FROM members m
JOIN users u ON m.user_id = u.id
WHERE u.phone_number = '+919160825903';

-- 4. Check if there's a member with phone 9160825903 (the real member who should be linked)
SELECT id, user_id, full_name, email, phone_number, church_id
FROM members
WHERE phone_number = '+919160825903';

-- 5. Check for email collision — do multiple members share the same email?
SELECT m.id, m.user_id, m.full_name, m.email, m.phone_number, m.church_id
FROM members m
WHERE m.email IN (
  SELECT email FROM users WHERE phone_number = '+919160825903'
)
AND m.email IS NOT NULL AND m.email != '';

-- ============================================================
-- FIX: After identifying the issue, run the appropriate fix:
-- ============================================================

-- FIX A: If Solomon Raju's member has wrong user_id, clear it
-- UPDATE members SET user_id = NULL WHERE phone_number = '+919703322382' AND user_id IS NOT NULL;

-- FIX B: If the real member for 9160825903 exists but isn't linked, link them
-- UPDATE members SET user_id = (SELECT id FROM users WHERE phone_number = '+919160825903')
-- WHERE phone_number = '+919160825903' AND user_id IS NULL;

-- FIX C: Reset the user's full_name so it re-syncs from the CORRECT member next login
-- UPDATE users SET full_name = NULL WHERE phone_number = '+919160825903';
