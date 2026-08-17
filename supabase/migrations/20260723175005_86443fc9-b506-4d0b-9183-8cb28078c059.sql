
CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  label text NOT NULL,
  account_holder text NOT NULL,
  account_number text NOT NULL,
  extra text,
  instructions text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;
GRANT ALL ON public.payment_methods TO service_role;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated read payment methods" ON public.payment_methods FOR SELECT TO authenticated USING (true);
CREATE POLICY "admins manage payment methods" ON public.payment_methods FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_payment_methods_updated BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.payment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  is_bundle boolean NOT NULL DEFAULT false,
  year smallint,
  amount_dzd int NOT NULL,
  method_kind text NOT NULL,
  transaction_ref text,
  proof_path text,
  note text,
  status text NOT NULL DEFAULT 'pending',
  reviewer_id uuid,
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_requests_target_chk CHECK (is_bundle = true OR year IS NOT NULL),
  CONSTRAINT payment_requests_status_chk CHECK (status IN ('pending','approved','rejected'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_requests TO authenticated;
GRANT ALL ON public.payment_requests TO service_role;
ALTER TABLE public.payment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see their own requests" ON public.payment_requests FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "users create their own requests" ON public.payment_requests FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending');
CREATE POLICY "admins update requests" ON public.payment_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete requests" ON public.payment_requests FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_payment_requests_updated BEFORE UPDATE ON public.payment_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_payment_requests_user ON public.payment_requests(user_id);
CREATE INDEX idx_payment_requests_status ON public.payment_requests(status);

CREATE OR REPLACE FUNCTION public.approve_payment_request(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _req public.payment_requests%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO _req FROM public.payment_requests WHERE id = _request_id FOR UPDATE;
  IF _req.id IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  IF _req.status <> 'pending' THEN RAISE EXCEPTION 'already reviewed'; END IF;

  INSERT INTO public.user_entitlements (user_id, year, is_bundle, granted_by, note)
  VALUES (_req.user_id, CASE WHEN _req.is_bundle THEN NULL ELSE _req.year END, _req.is_bundle, auth.uid(),
    'Paiement approuvé #' || _req.id);

  UPDATE public.payment_requests
    SET status = 'approved', reviewer_id = auth.uid(), reviewed_at = now()
    WHERE id = _request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_payment_request(_request_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  UPDATE public.payment_requests
    SET status = 'rejected', reviewer_id = auth.uid(), reviewed_at = now(), reject_reason = _reason
    WHERE id = _request_id AND status = 'pending';
END;
$$;

CREATE POLICY "users upload own proofs" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'payment-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "users read own proofs" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'payment-proofs' AND ((storage.foldername(name))[1] = auth.uid()::text OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "admins manage proofs" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'payment-proofs' AND public.has_role(auth.uid(), 'admin'))
  WITH CHECK (bucket_id = 'payment-proofs' AND public.has_role(auth.uid(), 'admin'));

INSERT INTO public.payment_methods (kind, label, account_holder, account_number, instructions, sort_order)
VALUES
  ('baridimob', 'BaridiMob (Edahabia)', 'À configurer', '0000 0000 0000 0000', 'Envoyez le montant via BaridiMob puis soumettez la référence de la transaction et une capture d''écran.', 1),
  ('ccp', 'Compte CCP', 'À configurer', '0000000000 clé 00', 'Virement CCP. Précisez votre nom dans le motif, puis soumettez la preuve de versement.', 2);
