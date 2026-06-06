-- Link user profiles to a flat (optional — committee members may own a flat)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS flat_id uuid REFERENCES public.flats(id) ON DELETE SET NULL;

-- Rebuild v_users to expose flat info
DROP VIEW IF EXISTS public.v_users;
CREATE VIEW public.v_users AS
SELECT
  u.id,
  u.email                                   AS auth_email,
  u.created_at,
  u.last_sign_in_at,
  ur.role,
  ur.assigned_at,
  COALESCE(p.display_name, p.full_name)     AS display_name,
  p.mobile,
  p.contact_email,
  p.flat_id,
  f.code                                    AS flat_code
FROM auth.users u
LEFT JOIN public.user_roles ur ON ur.user_id = u.id
LEFT JOIN public.profiles    p  ON p.id      = u.id
LEFT JOIN public.flats       f  ON f.id      = p.flat_id;
