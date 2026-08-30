-- The authenticated cleanup RPC runs as project_admin and deletes only the
-- current user's avatar object keys selected from private metadata.
grant delete on table storage.objects to project_admin;
