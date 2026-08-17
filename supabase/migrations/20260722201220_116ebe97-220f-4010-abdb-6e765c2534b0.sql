
-- Prices per year of study
CREATE TABLE public.year_prices (
  year smallint PRIMARY KEY CHECK (year BETWEEN 1 AND 6),
  price_dzd integer NOT NULL DEFAULT 0 CHECK (price_dzd >= 0),
  sale_price_dzd integer CHECK (sale_price_dzd IS NULL OR sale_price_dzd >= 0),
  on_sale boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.year_prices TO authenticated;
GRANT ALL ON public.year_prices TO service_role;
ALTER TABLE public.year_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in reads year_prices" ON public.year_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins update year_prices" ON public.year_prices FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert year_prices" ON public.year_prices FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE TRIGGER year_prices_updated BEFORE UPDATE ON public.year_prices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Single-row pricing config for the "all years" bundle
CREATE TABLE public.pricing_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  bundle_price_dzd integer NOT NULL DEFAULT 0 CHECK (bundle_price_dzd >= 0),
  bundle_sale_price_dzd integer CHECK (bundle_sale_price_dzd IS NULL OR bundle_sale_price_dzd >= 0),
  bundle_on_sale boolean NOT NULL DEFAULT false,
  currency text NOT NULL DEFAULT 'DZD',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pricing_config TO authenticated;
GRANT ALL ON public.pricing_config TO service_role;
ALTER TABLE public.pricing_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in reads pricing_config" ON public.pricing_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins update pricing_config" ON public.pricing_config FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin')) WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert pricing_config" ON public.pricing_config FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE TRIGGER pricing_config_updated BEFORE UPDATE ON public.pricing_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Entitlements: which years a user has access to (year=NULL means all years / bundle)
CREATE TABLE public.user_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year smallint CHECK (year IS NULL OR year BETWEEN 1 AND 6),
  is_bundle boolean NOT NULL DEFAULT false,
  granted_by uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_entitlements_year_unique ON public.user_entitlements(user_id, year) WHERE year IS NOT NULL;
CREATE UNIQUE INDEX user_entitlements_bundle_unique ON public.user_entitlements(user_id) WHERE is_bundle = true;
GRANT SELECT ON public.user_entitlements TO authenticated;
GRANT ALL ON public.user_entitlements TO service_role;
ALTER TABLE public.user_entitlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own entitlements" ON public.user_entitlements FOR SELECT TO authenticated USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert entitlements" ON public.user_entitlements FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete entitlements" ON public.user_entitlements FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- Helper to check access (admins get everything)
CREATE OR REPLACE FUNCTION public.user_has_year_access(_user_id uuid, _year smallint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR EXISTS (
      SELECT 1 FROM public.user_entitlements
      WHERE user_id = _user_id
        AND (is_bundle = true OR year = _year)
    );
$$;

-- Seed defaults
INSERT INTO public.year_prices (year, price_dzd) VALUES
  (1, 2000), (2, 2000), (3, 2500), (4, 2500), (5, 3000), (6, 3000);
INSERT INTO public.pricing_config (id, bundle_price_dzd, bundle_sale_price_dzd, bundle_on_sale, currency)
  VALUES (1, 12000, 9000, true, 'DZD');
