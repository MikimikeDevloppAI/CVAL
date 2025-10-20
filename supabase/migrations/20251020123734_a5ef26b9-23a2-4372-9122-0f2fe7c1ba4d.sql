-- Add unique constraint to ensure a doctor can only have one besoin_effectif per date/period
-- This prevents double bookings at the database level
ALTER TABLE besoin_effectif 
ADD CONSTRAINT unique_medecin_date_periode 
UNIQUE (medecin_id, date, demi_journee);