-- Add posted_time to capture time-of-day from bank statement "Txn Posted Date" column.
-- Previously dropped by a bankDateToISO() bug that assumed the column was date-only.
alter table transactions add column posted_time text;
