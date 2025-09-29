-- Make profile_id optional for secretaires so a secretary can exist without an auth profile
ALTER TABLE public.secretaires
  ALTER COLUMN profile_id DROP NOT NULL;