import OpenAI from 'openai';

const defaultModel = process.env.OPENAI_MODEL;

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('OPENAI_API_KEY is not set');
}
const openai = new OpenAI({
  apiKey,
});

/**
 * Generates text using the OpenAI Responses API.
 * @param input - The prompt or instruction for the model.
 * @param options - Optional model override (default: gpt-5-nano or OPENAI_MODEL env).
 * @returns The generated text (response.output_text).
 */
export async function generateText(
  input: string,
  options?: { model?: string },
): Promise<string> {
  const model = options?.model ?? process.env.OPENAI_MODEL ?? defaultModel;

  const response = await openai.responses.create({
    model,
    input,
  });

  return response.output_text ?? '';
}
