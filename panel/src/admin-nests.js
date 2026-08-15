import { q, q1, genUuid } from './db.js';
import { requireAdmin } from './auth.js';

export async function adminNestRoutes(fastify) {
  // ── Nests ──────────────────────────────────────────────────
  fastify.get('/api/admin/nests', { preHandler: requireAdmin }, async () => {
    const nests = await q(
      `SELECT n.*, (SELECT count(*)::int FROM eggs e WHERE e.nest_id = n.id) AS egg_count
       FROM nests n ORDER BY n.created_at DESC`
    );
    return { nests };
  });

  fastify.post('/api/admin/nests', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, description } = req.body || {};
    if (!name) return reply.code(400).send({ error: 'name is required' });
    const nest = await q1(
      `INSERT INTO nests (uuid, name, description) VALUES ($1, $2, $3) RETURNING *`,
      [genUuid(), name, description || '']
    );
    return reply.code(201).send({ nest });
  });

  fastify.patch('/api/admin/nests/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, description } = req.body || {};
    const nest = await q1(
      `UPDATE nests SET name = COALESCE($1, name), description = COALESCE($2, description) WHERE id = $3 RETURNING *`,
      [name, description, req.params.id]
    );
    if (!nest) return reply.code(404).send({ error: 'Nest not found' });
    return { nest };
  });

  fastify.delete('/api/admin/nests/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const eggs = await q1(`SELECT count(*)::int AS c FROM eggs WHERE nest_id = $1`, [req.params.id]);
    if (eggs.c > 0) return reply.code(400).send({ error: 'Nest has eggs — delete them first' });
    await q(`DELETE FROM nests WHERE id = $1`, [req.params.id]);
    return { ok: true };
  });

  // ── Eggs ───────────────────────────────────────────────────
  fastify.get('/api/admin/nests/:nestId/eggs', { preHandler: requireAdmin }, async (req) => {
    const eggs = await q(
      `SELECT e.*, (SELECT count(*)::int FROM egg_variables v WHERE v.egg_id = e.id) AS variable_count
       FROM eggs e WHERE e.nest_id = $1 ORDER BY e.created_at DESC`,
      [req.params.nestId]
    );
    return { eggs };
  });

  fastify.get('/api/admin/eggs/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const egg = await q1(`SELECT * FROM eggs WHERE id = $1`, [req.params.id]);
    if (!egg) return reply.code(404).send({ error: 'Egg not found' });
    const variables = await q(`SELECT * FROM egg_variables WHERE egg_id = $1 ORDER BY created_at`, [egg.id]);
    return { egg, variables };
  });

  fastify.post('/api/admin/nests/:nestId/eggs', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, description, docker_image, startup_command, default_install_command, skip_install } = req.body || {};
    if (!name || !docker_image || !startup_command) {
      return reply.code(400).send({ error: 'name, docker_image and startup_command are required' });
    }
    const egg = await q1(
      `INSERT INTO eggs (uuid, nest_id, name, description, docker_image, startup_command, default_install_command, skip_install)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [genUuid(), req.params.nestId, name, description || '', docker_image, startup_command, default_install_command || null, !!skip_install]
    );
    return reply.code(201).send({ egg });
  });

  fastify.patch('/api/admin/eggs/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, description, docker_image, startup_command, default_install_command, skip_install } = req.body || {};
    const egg = await q1(
      `UPDATE eggs SET name = COALESCE($1, name), description = COALESCE($2, description),
       docker_image = COALESCE($3, docker_image), startup_command = COALESCE($4, startup_command),
       default_install_command = COALESCE($5, default_install_command), skip_install = COALESCE($6, skip_install)
       WHERE id = $7 RETURNING *`,
      [name, description, docker_image, startup_command, default_install_command, skip_install, req.params.id]
    );
    if (!egg) return reply.code(404).send({ error: 'Egg not found' });
    return { egg };
  });

  fastify.delete('/api/admin/eggs/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const servers = await q1(`SELECT count(*)::int AS c FROM servers WHERE egg_id = $1`, [req.params.id]);
    if (servers.c > 0) return reply.code(400).send({ error: 'Egg is in use by servers' });
    await q(`DELETE FROM eggs WHERE id = $1`, [req.params.id]);
    return { ok: true };
  });

  // ── Egg variables ─────────────────────────────────────────
  fastify.post('/api/admin/eggs/:id/variables', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, description, env_variable, default_value, user_viewable, user_editable, rules } = req.body || {};
    if (!name || !env_variable) return reply.code(400).send({ error: 'name and env_variable are required' });
    const v = await q1(
      `INSERT INTO egg_variables (egg_id, name, description, env_variable, default_value, user_viewable, user_editable, rules)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, name, description || '', env_variable, default_value || '', !!user_viewable, !!user_editable, rules || '']
    );
    return reply.code(201).send({ variable: v });
  });

  fastify.patch('/api/admin/egg-variables/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { name, description, env_variable, default_value, user_viewable, user_editable, rules } = req.body || {};
    const v = await q1(
      `UPDATE egg_variables SET name = COALESCE($1, name), description = COALESCE($2, description),
       env_variable = COALESCE($3, env_variable), default_value = COALESCE($4, default_value),
       user_viewable = COALESCE($5, user_viewable), user_editable = COALESCE($6, user_editable),
       rules = COALESCE($7, rules) WHERE id = $8 RETURNING *`,
      [name, description, env_variable, default_value, user_viewable, user_editable, rules, req.params.id]
    );
    if (!v) return reply.code(404).send({ error: 'Variable not found' });
    return { variable: v };
  });

  fastify.delete('/api/admin/egg-variables/:id', { preHandler: requireAdmin }, async (req) => {
    await q(`DELETE FROM egg_variables WHERE id = $1`, [req.params.id]);
    return { ok: true };
  });

  // ── Import a Pterodactyl egg (PTDL_v2 JSON) ───────────────────────
  // Accepts the standard Pterodactyl egg export format (name, docker_images,
  // startup, scripts.installation.script, variables) and creates/updates the
  // egg + variables in the selected nest. Works with eggs exported from any
  // Pterodactyl panel.
  fastify.post('/api/admin/eggs/import', { preHandler: requireAdmin }, async (req, reply) => {
    const { nest_id, egg_json } = req.body || {};
    if (!nest_id || !egg_json) return reply.code(400).send({ error: 'nest_id and egg_json are required' });
    let egg;
    try {
      egg = JSON.parse(egg_json);
    } catch {
      return reply.code(400).send({ error: 'Invalid egg JSON — check the file is a valid Pterodactyl egg export' });
    }
    if (!egg.name || !egg.startup) {
      return reply.code(400).send({ error: 'Egg must have a name and a startup command' });
    }
    const nest = await q1(`SELECT * FROM nests WHERE id = $1`, [nest_id]);
    if (!nest) return reply.code(404).send({ error: 'Nest not found' });

    const images = Object.values(egg.docker_images || {});
    const image = images[0] || 'ghcr.io/parkervcp/yolks:debian';
    const installScript = egg.scripts?.installation?.script || '';
    const installContainer = egg.scripts?.installation?.container || 'ghcr.io/parkervcp/yolks:debian';

    const existing = await q1(`SELECT id FROM eggs WHERE name = $1 AND nest_id = $2`, [egg.name, nest.id]);
    let eggId;
    if (existing) {
      await q(
        `UPDATE eggs SET docker_image=$1, startup_command=$2, default_install_command=$3, description=$4 WHERE id=$5`,
        [image, egg.startup, installScript, egg.description || '', existing.id]
      );
      eggId = existing.id;
      await q(`DELETE FROM egg_variables WHERE egg_id = $1`, [eggId]);
    } else {
      const e = await q1(
        `INSERT INTO eggs (uuid, nest_id, name, description, docker_image, startup_command, default_install_command, mount_target)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'/home/container') RETURNING id`,
        [genUuid(), nest.id, egg.name, egg.description || '', image, egg.startup, installScript]
      );
      eggId = e.id;
    }

    for (const v of egg.variables || []) {
      await q(
        `INSERT INTO egg_variables (egg_id, name, description, env_variable, default_value, user_viewable, user_editable, rules)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [eggId, v.name, v.description || '', v.env_variable, v.default_value || '', !!v.user_viewable, !!v.user_editable, v.rules || '']
      );
    }
    return reply.code(201).send({ egg: { id: eggId, name: egg.name, updated: !!existing } });
  });
}
