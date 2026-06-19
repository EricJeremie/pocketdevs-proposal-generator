insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('proposal-briefs', 'proposal-briefs', false, 12582912, array['application/pdf'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "proposal_briefs_insert_own" on storage.objects;
create policy "proposal_briefs_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'proposal-briefs'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "proposal_briefs_select_own" on storage.objects;
create policy "proposal_briefs_select_own"
on storage.objects for select to authenticated
using (
  bucket_id = 'proposal-briefs'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "proposal_briefs_delete_own" on storage.objects;
create policy "proposal_briefs_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'proposal-briefs'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
