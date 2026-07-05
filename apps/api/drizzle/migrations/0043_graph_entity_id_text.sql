-- 0043_graph_entity_id_text.sql
-- graph_nodes.entity_id is a stable source/dedup key. Structural nodes store the
-- doc/project UUID, but SEMANTIC extraction stores synthetic text keys like
-- "<workspaceId>-<concept-slug>". The column was uuid, so every concept upsert
-- failed with 22P02 (invalid input syntax for type uuid) and the whole graph
-- rebuild aborted. Widen to text; existing uuid values cast cleanly.
ALTER TABLE graph_nodes ALTER COLUMN entity_id TYPE text USING entity_id::text;
