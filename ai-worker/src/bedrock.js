import { AwsClient } from 'aws4fetch';

export async function converse(env, { system, messages, temperature = 0.3, maxTokens = 1024 }) {
  const client = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: env.AWS_REGION,
    service: 'bedrock',
  });

  const url = `https://bedrock-runtime.${env.AWS_REGION}.amazonaws.com/model/${encodeURIComponent(env.BEDROCK_MODEL_ID)}/converse`;

  const res = await client.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system,
      messages,
      inferenceConfig: { temperature, maxTokens },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Bedrock responded ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const textBlock = data?.output?.message?.content?.find(c => typeof c.text === 'string');
  if (!textBlock) throw new Error('Bedrock response missing text content');
  return textBlock.text;
}
