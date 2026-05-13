export type SpeechSubmitOptions = {
  diarizationEnabled?: boolean;
  fileBuffer?: Buffer;
  uploadElapsedMs?: number;
};

export type SpeechPollOptions = {
  diarizationEnabled?: boolean;
};

export type SpeechSubmitResult = {
  status: "queued" | "processing" | "completed" | "error";
  transcriptId: string;
  message: string;
  rawStatus?: string;
};

export type SpeechPollResult = {
  status: "queued" | "processing" | "completed" | "error";
  message: string;
  transcript?: string;
  rawStatus?: string;
  elapsedMs?: number;
};

export type SpeechProvider = {
  name: string;
  submit(file: File, options?: SpeechSubmitOptions): Promise<SpeechSubmitResult>;
  submitAudioUrl(audioUrl: string, options?: SpeechSubmitOptions): Promise<SpeechSubmitResult>;
  poll(transcriptId: string, options?: SpeechPollOptions): Promise<SpeechPollResult>;
};
