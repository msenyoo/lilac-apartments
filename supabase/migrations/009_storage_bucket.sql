-- Create expense-attachments storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-attachments',
  'expense-attachments',
  false,
  10485760,  -- 10 MB per file
  ARRAY['image/jpeg','image/jpg','image/png','image/webp','image/heic','application/pdf']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload
DROP POLICY IF EXISTS "exp_attach_insert" ON storage.objects;
CREATE POLICY "exp_attach_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-attachments');

-- Allow authenticated users to read
DROP POLICY IF EXISTS "exp_attach_select" ON storage.objects;
CREATE POLICY "exp_attach_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'expense-attachments');

-- Allow authenticated users to delete their own uploads
DROP POLICY IF EXISTS "exp_attach_delete" ON storage.objects;
CREATE POLICY "exp_attach_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'expense-attachments');
