-- Add unique index to besoins_fermeture_summary to enable CONCURRENTLY refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_bfs_unique ON besoins_fermeture_summary (date, site_id);

-- Make refresh function resilient with fallback to non-concurrent refresh
CREATE OR REPLACE FUNCTION public.refresh_all_besoins_summaries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Try concurrent refresh for besoins_sites_summary
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_sites_summary;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Concurrent refresh failed for besoins_sites_summary, falling back to regular refresh: %', SQLERRM;
    REFRESH MATERIALIZED VIEW besoins_sites_summary;
  END;

  -- Try concurrent refresh for besoins_bloc_operatoire_summary
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_bloc_operatoire_summary;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Concurrent refresh failed for besoins_bloc_operatoire_summary, falling back to regular refresh: %', SQLERRM;
    REFRESH MATERIALIZED VIEW besoins_bloc_operatoire_summary;
  END;

  -- Try concurrent refresh for besoins_fermeture_summary
  BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY besoins_fermeture_summary;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Concurrent refresh failed for besoins_fermeture_summary, falling back to regular refresh: %', SQLERRM;
    REFRESH MATERIALIZED VIEW besoins_fermeture_summary;
  END;
END;
$$;

-- Force immediate refresh of all views now that the unique index is in place
REFRESH MATERIALIZED VIEW besoins_sites_summary;
REFRESH MATERIALIZED VIEW besoins_bloc_operatoire_summary;
REFRESH MATERIALIZED VIEW besoins_fermeture_summary;