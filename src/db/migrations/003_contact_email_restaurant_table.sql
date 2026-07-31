ALTER TABLE restaurants
	ADD COLUMN contact_email VARCHAR(150) NULL AFTER slug;

UPDATE restaurants
SET contact_email = CONCAT('hello@', slug, '.local')
WHERE contact_email IS NULL OR contact_email = '';

ALTER TABLE restaurants
	MODIFY contact_email VARCHAR(150) NOT NULL;
