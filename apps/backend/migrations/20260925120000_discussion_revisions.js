// Explicit SQL keeps deferrable foreign keys compatible with legacy Knex.
exports.up = knex => knex.raw(`
  CREATE TABLE discussion_revisions (
    post_id bigint NOT NULL,
    version integer NOT NULL CHECK (version > 0),
    author_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    context text NOT NULL,
    summary text NOT NULL,
    open_questions jsonb NOT NULL,
    summary_changed boolean NOT NULL,
    PRIMARY KEY (post_id, version),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
  )
`)

exports.down = knex => knex.schema.dropTable('discussion_revisions')
