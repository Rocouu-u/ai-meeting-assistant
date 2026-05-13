export type GenerateMeetingReportInput = {
  transcript: string;
};

export type GenerateMeetingReportResult = {
  message: string;
  summary: string;
  outline: string;
};

export type LlmProvider = {
  name: string;
  generateMeetingReport(input: GenerateMeetingReportInput): Promise<GenerateMeetingReportResult>;
};
