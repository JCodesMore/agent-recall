const at = minute => new Date(Date.UTC(2026, 0, 5, 10, minute)).toISOString();

const envelope = (type, payload, minute, ordinal) => ({ timestamp: at(minute), ...(ordinal === undefined ? {} : { ordinal }), type, payload });
const item = (value, minute, ordinal) => envelope('event_msg', { type: 'item_completed', thread_id: 't', turn_id: 'turn', item: value }, minute, ordinal);

// Records in the shape Codex writes to ~/.codex/sessions/YYYY/MM/DD/rollout-<stamp>-<id>.jsonl.
export const codex = {
  meta: (id, extra = {}, ordinal) => envelope('session_meta', {
    id, session_id: id, cwd: '/work/demo', originator: 'codex_cli_rs', cli_version: '0.150.0', source: 'cli', model_provider: 'openai', git: { branch: 'main' }, ...extra,
  }, 0, ordinal),
  turn: (minute, model = 'gpt-test') => envelope('turn_context', { cwd: '/work/demo', model }, minute),
  // The model-context copy of a turn: injected context blocks, the request and image pixels.
  input: (role, texts, minute, images = []) => envelope('response_item', {
    type: 'message', role, content: [...texts.map(text => ({ type: role === 'assistant' ? 'output_text' : 'input_text', text })), ...images.map(url => ({ type: 'input_image', image_url: url }))],
  }, minute),
  user: (text, minute, blocks = [], ordinal) => item({ type: 'UserMessage', id: 'u', content: [{ type: 'text', text, text_elements: [] }, ...blocks] }, minute, ordinal),
  agent: (text, minute, ordinal) => item({ type: 'AgentMessage', id: 'm', content: [{ type: 'Text', text }], phase: 'final_answer' }, minute, ordinal),
  command: (command, minute) => item({ type: 'CommandExecution', id: 'c', command: ['bash', '-lc', command], aggregated_output: 'ok', status: 'completed' }, minute),
  userEvent: (message, minute, images) => envelope('event_msg', { type: 'user_message', message, ...(images ? { images } : {}) }, minute),
  agentEvent: (message, minute) => envelope('event_msg', { type: 'agent_message', message }, minute),
  call: (name, args, callId, minute) => envelope('response_item', { type: 'function_call', name, arguments: JSON.stringify(args), call_id: callId }, minute),
  custom: (name, input, callId, minute) => envelope('response_item', { type: 'custom_tool_call', name, input, call_id: callId, status: 'completed' }, minute),
  output: (callId, output, minute, type = 'function_call_output') => envelope('response_item', { type, call_id: callId, output }, minute),
  compacted: (text, minute) => envelope('compacted', { message: text, replacement_history: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }] }] }, minute),
  event: (type, minute, ordinal) => envelope('event_msg', { type }, minute, ordinal),
};
