-- Lets admins upload an image to use as a module's icon (dashboard cards)
-- instead of only a plain emoji. icon_image_path stores the object path in
-- the new public "module-icons" bucket; the dashboard prefers this image
-- over the emoji `icon` column when both are set. Public bucket (like the
-- module thumbnails shown to every signed-in user) so the dashboard can
-- render it directly via a public URL, no signed-URL round trip per module.
alter table public.modules add column if not exists icon_image_path text;

insert into storage.buckets (id, name, public)
values ('module-icons', 'module-icons', true)
on conflict (id) do nothing;

create policy "Public read module-icons"
  on storage.objects for select
  using (bucket_id = 'module-icons');

create policy "Admins upload module-icons"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'module-icons'
    and (public.has_permission(auth.uid(), 'manage_modules') or public.is_super_admin(auth.uid()))
  );

create policy "Admins update module-icons"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'module-icons'
    and (public.has_permission(auth.uid(), 'manage_modules') or public.is_super_admin(auth.uid()))
  );

create policy "Admins delete module-icons"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'module-icons'
    and (public.has_permission(auth.uid(), 'manage_modules') or public.is_super_admin(auth.uid()))
  );
