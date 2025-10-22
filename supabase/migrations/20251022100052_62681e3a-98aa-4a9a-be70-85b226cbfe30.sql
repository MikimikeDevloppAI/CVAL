-- Enable RLS on the materialized view
ALTER MATERIALIZED VIEW public.besoins_non_satisfaits_summary OWNER TO postgres;

-- Create RLS policies for the materialized view
-- Note: Materialized views don't support RLS directly, so we need to create a regular view on top
-- Or we can remove it from the API schema

-- Remove the materialized view from the API schema to prevent direct access
-- Users should access it through application logic with proper authorization
REVOKE ALL ON public.besoins_non_satisfaits_summary FROM anon, authenticated;

-- Grant SELECT only to authenticated users with planning access
-- This will be enforced at the application level
GRANT SELECT ON public.besoins_non_satisfaits_summary TO authenticated;