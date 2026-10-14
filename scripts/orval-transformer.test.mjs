import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const transformOperationIds = require("../packages/desktop/orval.transformer.cjs");

function operation(operationId) {
  return { operationId, responses: { 200: { description: "ok" } } };
}

test("strips only a terminal handler suffix and leaves unrelated path metadata alone", () => {
  const spec = {
    paths: {
      "/api/example": {
        parameters: [{ in: "header", name: "X-Example" }],
        get: operation("get_example_handler"),
        post: operation("handler_healthcheck"),
        put: operation("replace_handler_version"),
        "x-cadencr-note": "metadata",
      },
    },
  };

  const result = transformOperationIds(spec);

  assert.strictEqual(result, spec);
  assert.equal(spec.paths["/api/example"].get.operationId, "get_example");
  assert.equal(spec.paths["/api/example"].post.operationId, "handler_healthcheck");
  assert.equal(spec.paths["/api/example"].put.operationId, "replace_handler_version");
  assert.deepEqual(spec.paths["/api/example"].parameters, [{ in: "header", name: "X-Example" }]);
  assert.equal(spec.paths["/api/example"]["x-cadencr-note"], "metadata");
});

test("preserves every current public operation alias without collisions", () => {
  const cases = [
    ["list_settings_handler", "list_workspace_settings"],
    ["get_setting_handler", "get_workspace_setting"],
    ["set_setting_handler", "set_workspace_setting"],
    ["get_model_settings_handler", "get_workspace_model_settings"],
    ["set_model_setting_handler", "set_workspace_model_setting"],
    ["get_provider_settings_handler", "get_workspace_provider_settings"],
    ["set_provider_setting_handler", "set_workspace_provider_setting"],
    ["get_draft_handler", "get_session_draft"],
    ["save_draft_handler", "save_session_draft"],
    ["tree_handler", "file_tree"],
    ["search_handler", "file_search"],
    ["is_empty_handler", "is_feature_empty"],
    ["get_prd_handler", "get_feature_prd"],
    ["get_plan_with_phases_handler", "get_feature_plan"],
    ["get_plan_progress_handler", "get_feature_plan_progress"],
    ["get_working_dir_handler", "get_feature_working_dir"],
    ["list_actions_handler", "list_custom_actions"],
    ["create_action_handler", "create_custom_action"],
    ["update_action_handler", "update_custom_action"],
    ["delete_action_handler", "delete_custom_action"],
    ["list_variables_handler", "get_custom_action_variables"],
    ["set_variable_handler", "set_custom_action_variable"],
    ["run_action_handler", "run_custom_action"],
    ["list_runs_handler", "get_custom_action_runs"],
    ["cancel_run_handler", "cancel_custom_action_run"],
    ["get_schedule_handler", "get_custom_action_schedule"],
    ["set_schedule_handler", "set_custom_action_schedule"],
    ["get_schedule_by_id_handler", "get_schedule"],
    ["list_servers_handler", "list_lsp_servers"],
    ["status_handler", "remote_status"],
    ["enable_handler", "remote_enable"],
    ["disable_handler", "remote_disable"],
    ["pairing_code_handler", "remote_pairing_code"],
    ["pair_handler", "remote_pair"],
    ["revoke_handler", "remote_revoke_device"],
    ["set_tunnel_host_handler", "remote_set_tunnel_host"],
  ];
  const paths = Object.fromEntries(
    cases.map(([operationId], index) => [
      `/api/contract/${index}`,
      { get: operation(operationId) },
    ]),
  );

  transformOperationIds({ paths });

  const transformed = Object.values(paths).map(({ get }) => get.operationId);
  assert.deepEqual(
    transformed,
    cases.map(([, expected]) => expected),
  );
  assert.equal(new Set(transformed).size, transformed.length);
});

test("tolerates partial OpenAPI documents and operations without an operationId", () => {
  const withoutPaths = { openapi: "3.0.0" };
  const partial = {
    paths: {
      "/api/partial": {
        get: null,
        post: { responses: {} },
      },
    },
  };

  assert.strictEqual(transformOperationIds(withoutPaths), withoutPaths);
  assert.doesNotThrow(() => transformOperationIds(partial));
  assert.deepEqual(partial.paths["/api/partial"].post, { responses: {} });
});
