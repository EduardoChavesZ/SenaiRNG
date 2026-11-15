DO $$
DECLARE
  table_record RECORD;
BEGIN
  FOR table_record IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_record.tablename);
  END LOOP;
END;
$$;

ALTER FUNCTION public.create_default_user_profile() SET search_path = public, pg_temp;
