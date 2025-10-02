-- Create storage bucket for planning PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('planning-pdfs', 'planning-pdfs', true)
ON CONFLICT (id) DO NOTHING;

-- Create policies for planning PDFs
CREATE POLICY "Anyone can view planning PDFs"
ON storage.objects FOR SELECT
USING (bucket_id = 'planning-pdfs');

CREATE POLICY "Authenticated users can upload planning PDFs"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'planning-pdfs' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update planning PDFs"
ON storage.objects FOR UPDATE
USING (bucket_id = 'planning-pdfs' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete planning PDFs"
ON storage.objects FOR DELETE
USING (bucket_id = 'planning-pdfs' AND auth.role() = 'authenticated');