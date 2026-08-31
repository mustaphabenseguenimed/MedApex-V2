-- The "explanation-images" storage bucket was never actually created —
-- migration 20260726211550 added RLS policies for bucket_id =
-- 'explanation-images' but nothing ever inserted the bucket row itself,
-- so every image upload on a question explanation has been failing with
-- "Bucket not found". Private bucket: access goes through signed URLs
-- (see resolveStorageUrls in src/components/RichText.tsx), matching the
-- existing authenticated+permission-gated RLS policies on this bucket.
insert into storage.buckets (id, name, public)
values ('explanation-images', 'explanation-images', false)
on conflict (id) do nothing;
