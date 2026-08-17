CREATE OR REPLACE FUNCTION private.list_all_users()
RETURNS TABLE(user_id uuid, email text, display_name text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT u.id, u.email::text, p.display_name, u.created_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  WHERE private.is_super_admin(auth.uid())
  ORDER BY u.created_at DESC
$$;

CREATE OR REPLACE FUNCTION public.list_all_users()
RETURNS TABLE(user_id uuid, email text, display_name text, created_at timestamptz)
LANGUAGE sql STABLE SET search_path TO 'public'
AS $$ SELECT * FROM private.list_all_users() $$;

REVOKE ALL ON FUNCTION public.list_all_users() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_all_users() TO authenticated;