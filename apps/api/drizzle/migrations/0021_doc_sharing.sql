-- Doc sharing: public reader link
ALTER TABLE docs ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;
ALTER TABLE docs ADD COLUMN IF NOT EXISTS public_token uuid UNIQUE;
