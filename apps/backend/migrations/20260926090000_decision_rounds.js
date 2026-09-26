// Keep the snapshot and upgrade path equivalent (see decision-schema integration test).
const schema = `
CREATE TABLE public.decision_rounds (
  id uuid PRIMARY KEY,
  post_id bigint NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  group_id bigint NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  previous_round_id uuid REFERENCES public.decision_rounds(id) DEFERRABLE INITIALLY DEFERRED,
  phase text NOT NULL CHECK (phase IN ('draft', 'open', 'closed', 'cancelled')),
  version integer NOT NULL CHECK (version > 0),
  config jsonb NOT NULL,
  electorate_count integer NOT NULL DEFAULT 0 CHECK (electorate_count >= 0),
  created_by bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  opened_at timestamptz,
  closed_at timestamptz
);
CREATE INDEX decision_rounds_post_index ON public.decision_rounds(post_id, created_at);
CREATE TABLE public.decision_electorate (
  round_id uuid NOT NULL REFERENCES public.decision_rounds(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  user_id bigint NOT NULL,
  PRIMARY KEY (round_id, user_id)
);
CREATE TABLE public.decision_ballots (
  round_id uuid NOT NULL,
  user_id bigint NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  state text NOT NULL CHECK (state IN ('vote', 'abstained', 'withdrawn')),
  answers jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (round_id, user_id, version),
  FOREIGN KEY (round_id, user_id) REFERENCES public.decision_electorate(round_id, user_id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE public.decision_commands (
  post_id bigint NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  user_id bigint NOT NULL,
  request_id uuid NOT NULL,
  round_id uuid NOT NULL REFERENCES public.decision_rounds(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (post_id, user_id, request_id)
);
CREATE TABLE public.decision_events (
  round_id uuid NOT NULL REFERENCES public.decision_rounds(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  version integer NOT NULL,
  actor_id bigint NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (round_id, version)
);
CREATE FUNCTION public.guard_decision_round() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.phase <> 'draft' AND (NEW.config IS DISTINCT FROM OLD.config OR NEW.group_id <> OLD.group_id OR
    NEW.post_id <> OLD.post_id OR NEW.electorate_count <> OLD.electorate_count OR
    NEW.previous_round_id IS DISTINCT FROM OLD.previous_round_id OR NEW.opened_at IS DISTINCT FROM OLD.opened_at) THEN
    RAISE EXCEPTION 'Frozen decision round';
  END IF;
  IF (OLD.phase IN ('closed', 'cancelled') AND NEW IS DISTINCT FROM OLD) OR
    (OLD.phase = 'open' AND NEW.phase NOT IN ('open', 'closed', 'cancelled')) THEN
    RAISE EXCEPTION 'Terminal decision round';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER decision_round_immutable BEFORE UPDATE ON public.decision_rounds
  FOR EACH ROW EXECUTE FUNCTION public.guard_decision_round();
`
exports.schema = schema
exports.up = knex => knex.raw(schema)
exports.down = knex => knex.raw(`
  DROP TABLE public.decision_events, public.decision_commands, public.decision_ballots, public.decision_electorate, public.decision_rounds;
  DROP FUNCTION public.guard_decision_round();
`)
