export const assemblyAiBaseUrl = "https://api.assemblyai.com";

export type AssemblyAiTranscriptResponse = {
  id?: string;
  status?: "queued" | "processing" | "completed" | "error";
  text?: string | null;
  error?: string | null;
  utterances?: Array<{
    speaker?: string | number | null;
    text?: string | null;
  }> | null;
};

export function formatAssemblyAiTranscript(transcript: AssemblyAiTranscriptResponse) {
  const utterances = transcript.utterances ?? [];

  if (utterances.length === 0) {
    return transcript.text ?? "";
  }

  const speakerMap = new Map<string, string>();

  return utterances
    .map((utterance) => {
      const rawSpeaker = String(utterance.speaker ?? "unknown");

      if (!speakerMap.has(rawSpeaker)) {
        speakerMap.set(rawSpeaker, `发言人${speakerMap.size + 1}`);
      }

      return `${speakerMap.get(rawSpeaker)}：${utterance.text ?? ""}`;
    })
    .join("\n\n");
}
