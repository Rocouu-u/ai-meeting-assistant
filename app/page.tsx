"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";

type TaskStatus =
  | "idle"
  | "queued"
  | "uploading"
  | "transcribing"
  | "summarizing"
  | "completed"
  | "failed"
  | "still_processing";

type MeetingRecord = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
  date: string;
  duration: string;
  status: string;
  taskStatus: TaskStatus;
  transcript: string;
  summary: string;
  outline: string;
  audioFileName?: string;
  audioFileSize?: string;
  audioFileType?: string;
  audioFileSizeBytes?: number;
  durationSeconds?: number;
  transcriptId?: string;
  uploadProgress?: number;
  uploadNotice?: string;
  transcribeElapsedText?: string;
  errorMessage?: string;
};

type QueueItem = {
  recordId: string;
  file: File;
};

type TranscribeResponse = {
  ok?: boolean;
  status?: "queued" | "processing" | "completed" | "error";
  rawStatus?: string;
  message?: string;
  transcriptId?: string;
  transcript?: string;
  elapsedMs?: number;
};

type OssUploadPolicyResponse = {
  ok?: boolean;
  enabled?: boolean;
  message?: string;
  uploadUrl?: string;
  fileUrl?: string;
  fields?: Record<string, string>;
};

type GenerateReportResponse = {
  ok?: boolean;
  message?: string;
  summary?: string;
  outline?: string;
};

type AppConfigResponse = {
  ok?: boolean;
  recordRetentionDays?: number;
  ossAudioRetentionDays?: number;
};

type StoredMeetingRecord = {
  id: string;
  title: string;
  originalFileName?: string;
  fileSize?: number;
  fileSizeLabel?: string;
  fileType?: string;
  duration?: string;
  durationSeconds?: number;
  status?: string;
  taskStatus?: TaskStatus;
  transcript?: string;
  summary?: string;
  outline?: string;
  todos?: string;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
};

type HistoryResponse = {
  ok?: boolean;
  message?: string;
  records?: StoredMeetingRecord[];
  record?: StoredMeetingRecord;
  importedCount?: number;
  deletedCount?: number;
};

type PublicRuntimeConfig = {
  dashscopeApiKeyConfigured: boolean;
  dashscopeApiKeySaved: boolean;
  dashscopeApiKeyMasked: string;
  ossEnabled: boolean;
  ossRegion: string;
  ossBucket: string;
  ossConfigured: boolean;
  ossAccessKeyIdConfigured: boolean;
  ossAccessKeyIdSaved: boolean;
  ossAccessKeyIdMasked: string;
  ossAccessKeySecretConfigured: boolean;
  ossAccessKeySecretSaved: boolean;
  ossAccessKeySecretMasked: string;
  usingEnvFallback: boolean;
  setupComplete: boolean;
};

type SettingsResponse = {
  ok?: boolean;
  message?: string;
  config?: PublicRuntimeConfig;
};

type SettingsForm = {
  dashscopeApiKey: string;
  ossEnabled: boolean;
  ossRegion: string;
  ossBucket: string;
  ossAccessKeyId: string;
  ossAccessKeySecret: string;
};

type ConfigDisplayStatus = "未配置" | "已配置" | "测试通过" | "测试失败";

type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    types?: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
};

const buttonBase =
  "rounded-lg border px-3 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-50";
const localRecordsStorageKey = "meeting-ai-assistant.records";
const maxConcurrentUploads = 2;
const transcribePollIntervalMs = 5000;
const transcribeMaxPollAttempts = 240;
const longAudioNoticeAfterMs = 2 * 60 * 1000;
const ossNoProgressTimeoutMs = 75 * 1000;
const ossSlowNoticeAfterMs = 5 * 60 * 1000;
const defaultRecordRetentionDays = 30;
const defaultOssAudioRetentionDays = 7;
const defaultOssRegion = "oss-cn-hangzhou";
const ossRegionOptions = [
  { label: "华东1（杭州）oss-cn-hangzhou，推荐", value: "oss-cn-hangzhou" },
  { label: "华东2（上海）oss-cn-shanghai", value: "oss-cn-shanghai" },
  { label: "华北2（北京）oss-cn-beijing", value: "oss-cn-beijing" },
  { label: "华南1（深圳）oss-cn-shenzhen", value: "oss-cn-shenzhen" }
];
const transcribingTitle = "正在转写音频，请稍候…";
const transcribingDescription = "系统正在识别录音内容，长音频可能需要几分钟。任务提交后，可稍后在历史记录中查看结果。";
const longTranscribingDescription = "音频仍在处理中，长音频可能需要更久，请耐心等待。";
const emptyRecord: MeetingRecord = {
  id: "new-meeting",
  title: "新建会议",
  createdAt: new Date().toISOString(),
  date: "尚未上传",
  duration: "待识别",
  status: "等待上传",
  taskStatus: "idle",
  transcript: "",
  summary: "",
  outline: ""
};

export default function Home() {
  const [records, setRecords] = useState<MeetingRecord[]>([]);
  const [activeId, setActiveId] = useState(emptyRecord.id);
  const [notice, setNotice] = useState("");
  const [generateStatus, setGenerateStatus] = useState("");
  const [isExportingWord, setIsExportingWord] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isDraggingAudio, setIsDraggingAudio] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<PublicRuntimeConfig | null>(null);
  const [settingsForm, setSettingsForm] = useState<SettingsForm>({
    dashscopeApiKey: "",
    ossEnabled: true,
    ossRegion: defaultOssRegion,
    ossBucket: "",
    ossAccessKeyId: "",
    ossAccessKeySecret: ""
  });
  const [settingsStatus, setSettingsStatus] = useState("");
  const [dashscopeStatus, setDashscopeStatus] = useState<ConfigDisplayStatus>("未配置");
  const [ossStatus, setOssStatus] = useState<ConfigDisplayStatus>("未配置");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isTestingDashScope, setIsTestingDashScope] = useState(false);
  const [isTestingOss, setIsTestingOss] = useState(false);
  const [currentOrigin, setCurrentOrigin] = useState("");
  const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
  const [recordRetentionDays, setRecordRetentionDays] = useState(defaultRecordRetentionDays);
  const [hasLoadedLocalRecords, setHasLoadedLocalRecords] = useState(false);
  const uploadQueueRef = useRef<QueueItem[]>([]);
  const activeUploadCountRef = useRef(0);
  const uploadXhrRefs = useRef(new Map<string, XMLHttpRequest>());
  const abortReasonsRef = useRef(new Map<string, "user" | "stall">());
  const recordsRef = useRef<MeetingRecord[]>([]);

  const activeRecord = useMemo(
    () => records.find((record) => record.id === activeId) ?? emptyRecord,
    [activeId, records]
  );
  const pendingCount = records.filter((record) => record.taskStatus === "queued").length;
  const hasAnyRecord = records.length > 0;
  const hasUsableTranscript =
    Boolean(activeRecord.transcript.trim()) &&
    !["uploading", "transcribing", "still_processing", "failed", "queued", "idle"].includes(activeRecord.taskStatus);

  useEffect(() => {
    setCurrentOrigin(window.location.origin);
    void loadSettings();
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadConfig() {
      try {
        const response = await fetch("/api/app-config");
        const result = (await response.json()) as AppConfigResponse;

        if (!mounted || !result.ok) {
          return;
        }

        setRecordRetentionDays(result.recordRetentionDays ?? defaultRecordRetentionDays);
        void result.ossAudioRetentionDays;
      } catch {
        // 配置读取失败时使用默认保留时间。
      }
    }

    void loadConfig();

    return () => {
      mounted = false;
    };
  }, []);

  const loadSettings = async () => {
    try {
      const response = await fetch("/api/settings");
      const result = (await response.json()) as SettingsResponse;

      if (!response.ok || !result.ok || !result.config) {
        setShowSettings(true);
        return;
      }

      setSettings(result.config);
      setDashscopeStatus(result.config.dashscopeApiKeyConfigured ? "已配置" : "未配置");
      setOssStatus(result.config.ossConfigured ? "已配置" : "未配置");
      setSettingsForm((currentForm) => ({
        ...currentForm,
        ossEnabled: result.config?.ossEnabled ?? true,
        ossRegion: result.config?.ossRegion || defaultOssRegion,
        ossBucket: result.config?.ossBucket || ""
      }));

      if (!result.config.setupComplete) {
        setShowSettings(true);
      }
    } catch {
      setShowSettings(true);
    }
  };

  useEffect(() => {
    let mounted = true;

    async function loadHistory() {
      try {
        const response = await fetch("/api/history");
        const result = (await response.json()) as HistoryResponse;
        const sqliteRecords = result.ok && Array.isArray(result.records) ? result.records.map(fromStoredRecord) : [];
        const localRecords = readLocalRecords(recordRetentionDays);

        if (localRecords.length > 0) {
          await fetch("/api/history", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              records: localRecords.map(toStoredRecord)
            })
          });
        }

        const mergedRecords =
          localRecords.length > 0
            ? await fetchHistoryRecords()
            : sqliteRecords.filter((record) => isRecordRetained(record, recordRetentionDays));

        if (!mounted) {
          return;
        }

        recordsRef.current = mergedRecords;
        setRecords(mergedRecords);
        setActiveId(mergedRecords[0]?.id ?? emptyRecord.id);
      } catch {
        const fallbackRecords = readLocalRecords(recordRetentionDays);

        if (!mounted) {
          return;
        }

        recordsRef.current = fallbackRecords;
        setRecords(fallbackRecords);
        setActiveId(fallbackRecords[0]?.id ?? emptyRecord.id);
      } finally {
        if (mounted) {
          setHasLoadedLocalRecords(true);
        }
      }
    }

    void loadHistory();

    return () => {
      mounted = false;
    };
  }, [recordRetentionDays]);

  useEffect(() => {
    recordsRef.current = records;

    if (!hasLoadedLocalRecords) {
      return;
    }

    window.localStorage.setItem(localRecordsStorageKey, JSON.stringify(records));
  }, [hasLoadedLocalRecords, records]);

  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2200);
  };

  const updateSettingsForm = (patch: Partial<SettingsForm>) => {
    setSettingsForm((currentForm) => ({
      ...currentForm,
      ...patch
    }));
  };

  const handleSaveSettings = async () => {
    const missingFields = getMissingSettingsFields(settingsForm, settings);

    if (missingFields.length > 0) {
      setSettingsStatus(`缺少必填项：${missingFields.join("、")}`);
      return;
    }

    setIsSavingSettings(true);
    setSettingsStatus("");

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(settingsForm)
      });
      const result = (await response.json()) as SettingsResponse;

      if (!response.ok || !result.ok || !result.config) {
        setSettingsStatus(result.message || "配置保存失败，请检查填写内容。");
        return;
      }

      setSettings(result.config);
      setDashscopeStatus(result.config.dashscopeApiKeyConfigured ? "已配置" : "未配置");
      setOssStatus(result.config.ossConfigured ? "已配置" : "未配置");
      setSettingsForm((currentForm) => ({
        ...currentForm,
        dashscopeApiKey: "",
        ossAccessKeyId: "",
        ossAccessKeySecret: "",
        ossEnabled: result.config?.ossEnabled ?? true,
        ossRegion: result.config?.ossRegion || defaultOssRegion,
        ossBucket: result.config?.ossBucket || ""
      }));
      setSettingsStatus("配置已保存。");

      if (result.config.setupComplete) {
        setShowSettings(false);
      }
    } catch {
      setSettingsStatus("配置保存失败，请检查本地服务。");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleTestDashScope = async () => {
    setIsTestingDashScope(true);
    setSettingsStatus("正在测试百炼 API...");

    try {
      const response = await fetch("/api/settings/test-dashscope", {
        method: "POST"
      });
      const result = (await response.json()) as SettingsResponse;
      setDashscopeStatus(response.ok && result.ok ? "测试通过" : "测试失败");
      setSettingsStatus(result.message || (response.ok ? "百炼 API 连接成功。" : "百炼 API 连接失败。"));
    } catch {
      setDashscopeStatus("测试失败");
      setSettingsStatus("百炼 API 连接失败，请检查网络。");
    } finally {
      setIsTestingDashScope(false);
    }
  };

  const handleTestOss = async () => {
    setIsTestingOss(true);
    setSettingsStatus("正在测试 OSS 上传...");

    try {
      const policyResponse = await fetch("/api/settings/test-oss-policy", {
        method: "POST"
      });
      const policy = (await policyResponse.json()) as OssUploadPolicyResponse;

      if (!policyResponse.ok || !policy.ok || !policy.uploadUrl || !policy.fields) {
        setOssStatus("测试失败");
        setSettingsStatus(policy.message || "OSS 配置不完整，请先保存配置。");
        return;
      }

      const formData = new FormData();
      Object.entries(policy.fields).forEach(([key, value]) => {
        formData.append(key, value);
      });
      formData.append("file", new Blob(["meeting-ai-config-test"], { type: "text/plain" }), "meeting-ai-config-test.txt");

      const uploadResponse = await fetch(policy.uploadUrl, {
        method: "POST",
        body: formData
      });
      const responseText = await uploadResponse.text();

      if (uploadResponse.ok) {
        setOssStatus("测试通过");
        setSettingsStatus("OSS 上传测试成功。");
        return;
      }

      const ossCode = getOssErrorCode(responseText);
      const causeText = ossCode ? `错误码：${ossCode}。` : "";
      setOssStatus("测试失败");
      setSettingsStatus(
        `${causeText}OSS 上传测试失败。可能原因：Bucket 名称错误、Region 选错、AccessKey 无权限、OSS 欠费或 UserDisable、CORS 未配置。`
      );
    } catch {
      setOssStatus("测试失败");
      setSettingsStatus("OSS 上传测试失败。可能原因：网络异常、CORS 未配置，或 OSS 配置不正确。");
    } finally {
      setIsTestingOss(false);
    }
  };

  const updateRecordById = (recordId: string, patch: Partial<MeetingRecord>, options: { persist?: boolean } = {}) => {
    const currentRecords = recordsRef.current;
    const currentRecord = currentRecords.find((record) => record.id === recordId);

    if (!currentRecord) {
      return;
    }

    const updatedRecord = {
      ...currentRecord,
      ...patch,
      updatedAt: new Date().toISOString()
    };
    const updatedRecords = currentRecords.map((record) => (record.id === recordId ? updatedRecord : record));

    recordsRef.current = updatedRecords;
    setRecords(updatedRecords);

    if (options.persist !== false) {
      void updateHistoryRecord(updatedRecord);
    }
  };

  const updateActiveRecord = (patch: Partial<MeetingRecord>) => {
    updateRecordById(activeRecord.id, patch);
  };

  const updateRecord = (field: keyof Pick<MeetingRecord, "transcript" | "summary" | "outline">, value: string) => {
    updateActiveRecord({ [field]: value });
  };

  const openNewMeeting = () => {
    setActiveId(emptyRecord.id);
    setGenerateStatus("");
    showNotice("可以选择一个或多个会议录音");
  };

  const openRecord = (recordId: string) => {
    setActiveId(recordId);
    setGenerateStatus("");
  };

  const toggleSelectedRecord = (recordId: string) => {
    setSelectedRecordIds((currentIds) =>
      currentIds.includes(recordId) ? currentIds.filter((id) => id !== recordId) : [...currentIds, recordId]
    );
  };

  const renameRecord = (recordId: string) => {
    const record = records.find((item) => item.id === recordId);
    const nextTitle = window.prompt("请输入新的记录名称", record?.title ?? "");

    if (!nextTitle?.trim()) {
      return;
    }

    updateRecordById(
      recordId,
      {
        title: nextTitle.trim()
      },
      { persist: false }
    );
    void renameHistoryRecord(recordId, nextTitle.trim());
    showNotice("记录已重命名");
  };

  const deleteRecord = (recordId: string) => {
    const record = records.find((item) => item.id === recordId);

    if (!window.confirm(`确定删除“${record?.title ?? "这条记录"}”吗？删除后不可恢复。`)) {
      return;
    }

    abortUpload(recordId);
    const nextRecords = recordsRef.current.filter((item) => item.id !== recordId);
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    setSelectedRecordIds((currentIds) => currentIds.filter((id) => id !== recordId));
    void deleteHistoryRecord(recordId);

    if (activeId === recordId) {
      const nextRecord = nextRecords[0];
      setActiveId(nextRecord?.id ?? emptyRecord.id);
    }

    showNotice("记录已删除");
  };

  const deleteSelectedRecords = () => {
    if (selectedRecordIds.length === 0) {
      showNotice("请先选择要删除的记录");
      return;
    }

    if (!window.confirm(`确定删除选中的 ${selectedRecordIds.length} 条记录吗？删除后不可恢复。`)) {
      return;
    }

    selectedRecordIds.forEach(abortUpload);
    const nextRecords = recordsRef.current.filter((record) => !selectedRecordIds.includes(record.id));
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    void batchDeleteHistoryRecords(selectedRecordIds);

    if (selectedRecordIds.includes(activeId)) {
      const nextRecord = nextRecords[0];
      setActiveId(nextRecord?.id ?? emptyRecord.id);
    }

    setSelectedRecordIds([]);
    showNotice("已删除选中记录");
  };

  const handleAudioFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);

    if (files.length > 0) {
      selectAudioFiles(files);
    }

    event.target.value = "";
  };

  const handleAudioDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingAudio(true);
  };

  const handleAudioDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingAudio(false);
  };

  const handleAudioDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingAudio(false);

    const files = Array.from(event.dataTransfer.files ?? []);

    if (files.length > 0) {
      selectAudioFiles(files);
    }
  };

  const selectAudioFiles = (files: File[]) => {
    const validFiles = files.filter(isSupportedAudioFile);
    const invalidCount = files.length - validFiles.length;

    if (invalidCount > 0) {
      showNotice(`${invalidCount} 个文件格式不支持，请选择 mp3、wav、m4a、mp4。`);
    }

    if (validFiles.length === 0) {
      return;
    }

    const now = Date.now();
    const newRecords = validFiles.map((file, index) => {
      const recordId = `meeting-${now}-${index}`;
      const title = file.name.replace(/\.[^/.]+$/, "") || "新的会议录音";

      uploadQueueRef.current.push({
        recordId,
        file
      });

      readAudioDuration(file).then((durationSeconds) => {
        if (!durationSeconds) {
          return;
        }

        updateRecordById(recordId, {
          duration: formatDuration(durationSeconds),
          durationSeconds
        });
      });

      return createRecordFromFile(recordId, title, file);
    });

    const nextRecords = [...newRecords, ...recordsRef.current];
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
    setActiveId(newRecords[0].id);
    showNotice(`已创建 ${newRecords.length} 条转写任务`);
    void Promise.all(newRecords.map(createHistoryRecord)).finally(() => {
      processUploadQueue();
    });
  };

  const processUploadQueue = () => {
    while (activeUploadCountRef.current < maxConcurrentUploads && uploadQueueRef.current.length > 0) {
      const item = uploadQueueRef.current.shift();

      if (!item) {
        return;
      }

      activeUploadCountRef.current += 1;
      void processQueuedFile(item).finally(() => {
        activeUploadCountRef.current = Math.max(0, activeUploadCountRef.current - 1);
        processUploadQueue();
      });
    }
  };

  const processQueuedFile = async ({ recordId, file }: QueueItem) => {
    updateRecordById(recordId, {
      status: "上传中",
      taskStatus: "uploading",
      uploadProgress: 0,
      uploadNotice: "正在上传音频，请稍候。",
      transcript: "音频上传中，请稍候。\n\n长音频处理时间会受网络和录音质量影响，请保持页面打开直到任务提交成功。",
      errorMessage: ""
    });

    try {
      const { result, response } = await submitTranscription(file, recordId);

      if (!response.ok || !result.ok || !result.transcriptId) {
        const message = getFriendlyTranscribeError(result.message);
        markRecordFailed(recordId, message);
        return;
      }

      updateRecordById(recordId, {
        status: "转写中",
        taskStatus: "transcribing",
        transcriptId: result.transcriptId,
        transcript: `${transcribingTitle}\n\n${transcribingDescription}`,
        uploadNotice: "任务已提交，正在转写音频。"
      });

      const transcript = await pollTranscriptionResult(result.transcriptId, recordId);

      if (!transcript) {
        return;
      }

      await generateReportForRecord(recordId, transcript);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "转写失败，请重试或检查音频文件。";

      markRecordFailed(recordId, message);
    }
  };

  const submitTranscription = async (file: File, recordId: string) => {
    const ossAttempt = await trySubmitWithOssDirectUpload(file, recordId);

    if (ossAttempt) {
      return ossAttempt;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("transcribeMode", "standard");

    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: formData
    });
    const result = await readJsonResponse<TranscribeResponse>(response);

    return { response, result };
  };

  const trySubmitWithOssDirectUpload = async (file: File, recordId: string) => {
    const policyResponse = await fetch("/api/oss/upload-policy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        fileName: file.name,
        fileType: file.type || getFileTypeFromName(file.name),
        fileSize: file.size
      })
    });
    const policy = await readJsonResponse<OssUploadPolicyResponse>(policyResponse);

    if (!policyResponse.ok || !policy.ok) {
      throw new Error(policy.message || "OSS 直传配置获取失败，请检查 OSS 配置。");
    }

    if (!policy.enabled) {
      return null;
    }

    if (!policy.uploadUrl || !policy.fileUrl || !policy.fields) {
      throw new Error("OSS 直传配置不完整，请检查 .env.local。");
    }

    const uploadStartedAt = Date.now();
    await sendClientLog("oss_direct_upload_start", {
      fileType: file.type || getFileTypeFromName(file.name),
      fileSize: file.size
    });

    const directUploadElapsedMs = await uploadFileToOssWithProgress(
      {
        uploadUrl: policy.uploadUrl,
        fields: policy.fields
      },
      file,
      recordId,
      uploadStartedAt
    );

    await sendClientLog("oss_direct_upload_done", {
      elapsedMs: directUploadElapsedMs,
      fileType: file.type || getFileTypeFromName(file.name),
      fileSize: file.size,
      progress: 100,
      message: "ok"
    });

    const transcribeFormData = new FormData();
    transcribeFormData.append("audioUrl", policy.fileUrl);
    transcribeFormData.append("fileName", file.name);
    transcribeFormData.append("fileSize", String(file.size));
    transcribeFormData.append("fileType", file.type || getFileTypeFromName(file.name));
    transcribeFormData.append("directUploadElapsedMs", String(directUploadElapsedMs));
    transcribeFormData.append("transcribeMode", "standard");

    const response = await fetch("/api/transcribe", {
      method: "POST",
      body: transcribeFormData
    });
    const result = await readJsonResponse<TranscribeResponse>(response);

    return { response, result };
  };

  const uploadFileToOssWithProgress = (
    policy: Required<Pick<OssUploadPolicyResponse, "uploadUrl" | "fields">>,
    file: File,
    recordId: string,
    uploadStartedAt: number
  ) => {
    const fileType = file.type || getFileTypeFromName(file.name);

    return new Promise<number>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const ossFormData = new FormData();
      let settled = false;
      let lastLoaded = 0;
      let latestProgress = 0;
      let lastProgressAt = Date.now();
      let lastLoggedProgress = -10;
      let slowNoticeShown = false;

      Object.entries(policy.fields).forEach(([key, value]) => {
        ossFormData.append(key, value);
      });
      ossFormData.append("file", file, file.name);

      const clearTimers = () => {
        window.clearInterval(stallTimer);
        window.clearInterval(slowNoticeTimer);
      };

      const failOnce = (message: string) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimers();
        uploadXhrRefs.current.delete(recordId);
        reject(new Error(message));
      };

      const stallTimer = window.setInterval(() => {
        if (settled || Date.now() - lastProgressAt < ossNoProgressTimeoutMs) {
          return;
        }

        const message = "上传可能已卡住，请检查网络后重试，或更换网络。";
        abortReasonsRef.current.set(recordId, "stall");
        updateRecordById(recordId, {
          status: "失败",
          taskStatus: "failed",
          uploadNotice: message,
          errorMessage: message,
          transcript: `${message}\n\n可以重新选择这段录音后再试一次。`
        });
        void sendClientLog("oss_direct_upload_stalled", {
          elapsedMs: Date.now() - uploadStartedAt,
          fileType,
          fileSize: file.size,
          progress: latestProgress,
          loaded: lastLoaded
        });
        xhr.abort();
        failOnce(message);
      }, 5000);

      const slowNoticeTimer = window.setInterval(() => {
        if (settled || slowNoticeShown || Date.now() - uploadStartedAt < ossSlowNoticeAfterMs) {
          return;
        }

        slowNoticeShown = true;
        updateRecordById(recordId, {
          uploadNotice: "当前网络较慢，请耐心等待。",
          transcript: "当前网络较慢，请耐心等待。\n\n任务提交成功后，可稍后在历史记录中查看结果。"
        });
      }, 5000);

      uploadXhrRefs.current.set(recordId, xhr);
      abortReasonsRef.current.delete(recordId);

      xhr.upload.onprogress = (event) => {
        if (settled || !event.lengthComputable || event.loaded <= lastLoaded) {
          return;
        }

        lastLoaded = event.loaded;
        lastProgressAt = Date.now();
        latestProgress = Math.min(100, Math.round((event.loaded / event.total) * 100));
        updateRecordById(recordId, {
          uploadProgress: latestProgress,
          uploadNotice: `正在上传音频，已上传 ${latestProgress}%。`
        });

        if (latestProgress >= lastLoggedProgress + 10 || latestProgress === 100) {
          lastLoggedProgress = latestProgress;
          void sendClientLog("oss_direct_upload_progress", {
            elapsedMs: Date.now() - uploadStartedAt,
            fileType,
            fileSize: file.size,
            progress: latestProgress,
            loaded: event.loaded,
            total: event.total
          });
        }
      };

      xhr.onload = () => {
        if (settled) {
          return;
        }

        const elapsedMs = Date.now() - uploadStartedAt;

        if (xhr.status >= 200 && xhr.status < 300) {
          settled = true;
          clearTimers();
          uploadXhrRefs.current.delete(recordId);
          updateRecordById(recordId, {
            uploadProgress: 100,
            uploadNotice: "上传完成，正在提交转写任务。",
            status: "转写中",
            taskStatus: "transcribing",
            transcript: `${transcribingTitle}\n\n${transcribingDescription}`
          });
          resolve(elapsedMs);
          return;
        }

        const ossErrorMessage = getFriendlyOssError(xhr.responseText);

        void sendClientLog("oss_direct_upload_failed", {
          elapsedMs,
          fileType,
          fileSize: file.size,
          progress: latestProgress,
          message: getOssErrorCode(xhr.responseText) ?? `status_${xhr.status}`
        });
        failOnce(ossErrorMessage);
      };

      xhr.onerror = () => {
        failOnce("OSS 直传失败，请检查网络、Bucket CORS 或 OSS 配置后重试。");
      };

      xhr.onabort = () => {
        if (settled) {
          return;
        }

        const reason = abortReasonsRef.current.get(recordId);

        if (reason === "user") {
          void sendClientLog("oss_direct_upload_aborted", {
            elapsedMs: Date.now() - uploadStartedAt,
            fileType,
            fileSize: file.size,
            progress: latestProgress,
            loaded: lastLoaded,
            message: "user_cancelled"
          });
          failOnce("上传已取消，可以重新选择录音。");
          return;
        }

        if (reason === "stall") {
          failOnce("上传可能已卡住，请检查网络后重试，或更换网络。");
          return;
        }

        failOnce("上传已中断，请检查网络后重试。");
      };

      xhr.open("POST", policy.uploadUrl);
      xhr.send(ossFormData);
    });
  };

  const pollTranscriptionResult = async (transcriptId: string, recordId: string) => {
    const pollStartedAt = Date.now();

    for (let attempt = 1; attempt <= transcribeMaxPollAttempts; attempt += 1) {
      await wait(transcribePollIntervalMs);

      const response = await fetch(`/api/transcribe/${transcriptId}?mode=standard`);
      const result = await readJsonResponse<TranscribeResponse>(response);
      const elapsedMs = result.elapsedMs ?? Date.now() - pollStartedAt;

      if (!response.ok || !result.ok) {
        const message = getFriendlyTranscribeError(result.message);
        markRecordFailed(recordId, message);
        return null;
      }

      if (result.status === "completed" && result.transcript) {
        const elapsedText = result.elapsedMs ? formatElapsedTime(result.elapsedMs) : "";

        updateRecordById(recordId, {
          status: "生成纪要中",
          taskStatus: "summarizing",
          transcript: result.transcript,
          transcribeElapsedText: elapsedText,
          summary: "正在生成会议纪要...",
          outline: "正在生成会议大纲..."
        });
        return result.transcript;
      }

      const isLongProcessing = elapsedMs >= longAudioNoticeAfterMs;

      void sendClientLog("transcribe_polling_status", {
        elapsedMs,
        message: result.rawStatus ?? result.status ?? "processing"
      });

      updateRecordById(recordId, {
        status: isLongProcessing ? "转写中" : "转写中",
        taskStatus: "transcribing",
        transcript: `${transcribingTitle}\n\n${isLongProcessing ? longTranscribingDescription : transcribingDescription}`
      });
    }

    updateRecordById(recordId, {
      status: "转写中",
      taskStatus: "still_processing",
      transcript: "转写任务仍在处理中，请稍后回来查看结果。\n\n系统会保留当前会议记录，后续可以在左侧历史记录中重新打开查看。"
    });
    return null;
  };

  const generateReportForRecord = async (recordId: string, transcript: string) => {
    updateRecordById(recordId, {
      status: "生成纪要中",
      taskStatus: "summarizing",
      summary: "正在生成会议纪要...",
      outline: "正在生成会议大纲..."
    });

    try {
      const response = await fetch("/api/generate-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ transcript })
      });
      const result = (await response.json()) as GenerateReportResponse;

      if (!response.ok || !result.ok) {
        markRecordFailed(recordId, getFriendlyGenerateError(result.message));
        return;
      }

      updateRecordById(recordId, {
        status: "已完成",
        taskStatus: "completed",
        summary: result.summary || "未生成会议纪要。",
        outline: result.outline || "未生成会议大纲。"
      });
      showNotice("会议纪要和会议大纲已生成");
    } catch {
      markRecordFailed(recordId, "会议纪要生成失败，请稍后重试。");
    }
  };

  const handleGenerateReport = async () => {
    const transcript = activeRecord.transcript.trim();

    if (!transcript || !hasUsableTranscript) {
      showNotice("请先等待转写完成");
      return;
    }

    setGenerateStatus("正在生成会议纪要和会议大纲，请稍候。");
    await generateReportForRecord(activeRecord.id, transcript);
    setGenerateStatus("");
  };

  const markRecordFailed = (recordId: string, message: string) => {
    updateRecordById(recordId, {
      status: "失败",
      taskStatus: "failed",
      errorMessage: message,
      uploadNotice: message,
      transcript: `${message}\n\n可以重新选择这段录音后再试一次。`
    });
  };

  const abortUpload = (recordId: string) => {
    const xhr = uploadXhrRefs.current.get(recordId);

    if (!xhr) {
      return;
    }

    abortReasonsRef.current.set(recordId, "user");
    xhr.abort();
  };

  const handleExportWord = async () => {
    if (!canExportRecord(activeRecord)) {
      showNotice("当前记录暂无可导出的内容");
      return;
    }

    setIsExportingWord(true);

    try {
      const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx");
      const doc = new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                heading: HeadingLevel.TITLE,
                children: [new TextRun(activeRecord.title)]
              }),
              ...createWordSection("会议纪要", activeRecord.summary, { Paragraph, TextRun, HeadingLevel }),
              ...createWordSection("会议大纲", activeRecord.outline, { Paragraph, TextRun, HeadingLevel })
            ]
          }
        ]
      });
      const blob = await Packer.toBlob(doc);
      await saveBlobWithPicker(
        blob,
        `${sanitizeDownloadFileName(activeRecord.title)}-会议纪要.docx`,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      );
      showNotice("Word 已导出");
    } catch (error) {
      showNotice(isSaveCancelled(error) ? "已取消导出" : "Word 导出失败，请稍后重试");
    } finally {
      setIsExportingWord(false);
    }
  };

  const handleExportPdf = async () => {
    if (!canExportRecord(activeRecord)) {
      showNotice("当前记录暂无可导出的内容");
      return;
    }

    setIsExportingPdf(true);

    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const exportNode = createPdfExportNode(activeRecord);

      document.body.appendChild(exportNode);
      const canvas = await html2canvas(exportNode, {
        scale: 2,
        backgroundColor: "#ffffff"
      });
      document.body.removeChild(exportNode);

      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const imageWidth = pageWidth - margin * 2;
      const imageHeight = (canvas.height * imageWidth) / canvas.width;
      let remainingHeight = imageHeight;
      let position = margin;

      const imageData = canvas.toDataURL("image/png");
      pdf.addImage(imageData, "PNG", margin, position, imageWidth, imageHeight);
      remainingHeight -= pageHeight - margin * 2;

      while (remainingHeight > 0) {
        position = remainingHeight - imageHeight + margin;
        pdf.addPage();
        pdf.addImage(imageData, "PNG", margin, position, imageWidth, imageHeight);
        remainingHeight -= pageHeight - margin * 2;
      }

      await saveBlobWithPicker(
        pdf.output("blob"),
        `${sanitizeDownloadFileName(activeRecord.title)}-会议纪要.pdf`,
        "application/pdf"
      );
      showNotice("PDF 已导出");
    } catch (error) {
      showNotice(isSaveCancelled(error) ? "已取消导出" : "PDF 导出失败，请稍后重试");
    } finally {
      setIsExportingPdf(false);
    }
  };

  const copyText = async (label: string, value: string) => {
    if (!value.trim()) {
      showNotice(`暂无${label}可复制`);
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      showNotice(`已复制${label}`);
    } catch {
      showNotice("复制失败，请手动选择文本复制");
    }
  };

  return (
    <main className="min-h-screen bg-slate-100 text-slate-800">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="border-b border-slate-800 bg-[#1a1d21] text-slate-100 lg:w-[265px] lg:border-b-0 lg:border-r">
          <div className="px-5 py-6">
            <h1 className="text-xl font-semibold tracking-normal text-white">AI 会议助手</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">本地会议录音转写与纪要生成工具</p>
          </div>

          <nav className="px-3 pb-5">
            <button
              className={`${buttonBase} mb-3 w-full border-slate-700 bg-slate-800 text-slate-100 shadow-sm hover:bg-slate-700`}
              type="button"
              onClick={openNewMeeting}
            >
              ＋ 新建会议
            </button>
            <button
              className="mb-5 flex w-full items-center rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-400 transition hover:bg-slate-800 hover:text-white"
              type="button"
              onClick={() => setShowSettings(true)}
            >
              系统配置
            </button>

            <div className="mb-3 flex items-center justify-between px-2">
              <div>
                <p className="text-sm font-medium text-slate-200">最近会议</p>
                <p className="mt-1 text-xs text-slate-500">默认保留 {recordRetentionDays} 天</p>
              </div>
              <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-400">{records.length} 条</span>
            </div>

            <div className="mb-3 flex gap-2 px-2">
              <button
                className={`${buttonBase} flex-1 border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`}
                type="button"
                disabled={selectedRecordIds.length === 0}
                onClick={deleteSelectedRecords}
              >
                删除所选
              </button>
              <button
                className={`${buttonBase} border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`}
                type="button"
                disabled={!hasAnyRecord}
                onClick={() =>
                  setSelectedRecordIds((currentIds) => (currentIds.length === records.length ? [] : records.map((record) => record.id)))
                }
              >
                {selectedRecordIds.length === records.length && records.length > 0 ? "取消全选" : "全选"}
              </button>
            </div>

            <div className="max-h-[calc(100vh-250px)] space-y-2 overflow-y-auto pr-1">
              {records.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-700 bg-slate-800/60 px-3 py-4 text-sm leading-6 text-slate-400">
                  暂无历史记录。选择录音后，每个音频会自动生成一条记录。
                </div>
              ) : null}

              {records.map((record) => {
                const isActive = record.id === activeRecord.id;

                return (
                  <div
                    key={record.id}
                    className={`rounded-xl border px-3 py-3 transition ${
                      isActive
                        ? "border-blue-500/70 bg-slate-800 text-white shadow-sm"
                        : "border-transparent bg-transparent text-slate-300 hover:border-slate-700 hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex gap-2">
                      <input
                        className="mt-1 h-4 w-4 shrink-0"
                        type="checkbox"
                        checked={selectedRecordIds.includes(record.id)}
                        onChange={() => toggleSelectedRecord(record.id)}
                      />
                      <button className="min-w-0 flex-1 text-left" type="button" onClick={() => openRecord(record.id)}>
                        <span className="block truncate text-sm font-medium">{record.title}</span>
                        <span className={`mt-1 block text-xs ${isActive ? "text-slate-400" : "text-slate-500"}`}>
                          {record.date} · {record.duration}
                        </span>
                        {record.audioFileName ? (
                          <span className={`mt-1 block truncate text-xs ${isActive ? "text-slate-400" : "text-slate-500"}`}>
                            {record.audioFileName}
                          </span>
                        ) : null}
                        <span className="mt-2 flex items-center gap-2">
                          <StatusBadge status={record.taskStatus} label={record.status} />
                          {record.taskStatus === "uploading" && typeof record.uploadProgress === "number" ? (
                            <span className={`text-xs ${isActive ? "text-slate-400" : "text-slate-400"}`}>{record.uploadProgress}%</span>
                          ) : null}
                        </span>
                      </button>
                    </div>
                    <div className="mt-3 flex gap-2 pl-6">
                      <button
                        className={`text-xs ${isActive ? "text-slate-400 hover:text-white" : "text-slate-500 hover:text-white"}`}
                        type="button"
                        onClick={() => renameRecord(record.id)}
                      >
                        重命名
                      </button>
                      <button
                        className={`text-xs ${isActive ? "text-slate-400 hover:text-red-300" : "text-slate-500 hover:text-red-300"}`}
                        type="button"
                        onClick={() => deleteRecord(record.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </nav>
        </aside>

        <section className="flex-1 px-4 py-5 sm:px-7 lg:px-8">
          <div className="mx-auto max-w-7xl">
            {showSettings ? (
              <SettingsPanel
                currentOrigin={currentOrigin}
                form={settingsForm}
                settings={settings}
                settingsStatus={settingsStatus}
                dashscopeStatus={dashscopeStatus}
                ossStatus={ossStatus}
                isSavingSettings={isSavingSettings}
                isTestingDashScope={isTestingDashScope}
                isTestingOss={isTestingOss}
                onChange={updateSettingsForm}
                onSave={handleSaveSettings}
                onTestDashScope={handleTestDashScope}
                onTestOss={handleTestOss}
                onClose={() => {
                  if (settings?.setupComplete) {
                    setShowSettings(false);
                    return;
                  }

                  setSettingsStatus("请先完成系统配置并保存。");
                }}
              />
            ) : (
              <>
            <header className="mb-5 border-b border-slate-200 pb-5 lg:flex lg:items-end lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-slate-500">当前会议</p>
                  {activeRecord.id !== emptyRecord.id ? <StatusBadge status={activeRecord.taskStatus} label={activeRecord.status} /> : null}
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-normal text-slate-950">{activeRecord.title}</h2>
                  <p className="mt-2 max-w-2xl text-sm text-slate-500">
                  {activeRecord.id === emptyRecord.id
                    ? "选择一个或多个会议录音后，系统会自动生成转写文本、会议纪要和会议大纲。"
                    : `${activeRecord.date} · ${activeRecord.duration} · ${activeRecord.status}`}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 lg:mt-0">
                <button
                  className={`${buttonBase} border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50`}
                  type="button"
                  disabled={!hasUsableTranscript}
                  onClick={handleGenerateReport}
                >
                  重新生成纪要
                </button>
                <button
                  className={`${buttonBase} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
                  type="button"
                  disabled={!activeRecord.transcript.trim() && !activeRecord.summary.trim() && !activeRecord.outline.trim()}
                  onClick={() =>
                    copyText(
                      "全部内容",
                      `# 转写文本\n${activeRecord.transcript}\n\n# 会议纪要\n${activeRecord.summary}\n\n# 会议大纲\n${activeRecord.outline}`
                    )
                  }
                >
                  复制全部
                </button>
              </div>
            </header>

            {notice ? (
              <div className="mb-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
                {notice}
              </div>
            ) : null}

            {generateStatus ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 shadow-sm">
                {generateStatus}
              </div>
            ) : null}

            <section
              className={`mb-5 rounded-xl border border-dashed bg-white px-5 py-4 shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition ${
                isDraggingAudio ? "border-slate-950 ring-2 ring-slate-200" : "border-slate-300"
              }`}
              onDragOver={handleAudioDragOver}
              onDragLeave={handleAudioDragLeave}
              onDrop={handleAudioDrop}
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-base font-semibold tracking-normal text-slate-950">上传会议录音</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-500">
                    支持格式：mp3、wav、m4a、mp4。长音频处理时间会受网络和录音质量影响。
                  </p>
                </div>
                <label className={`${buttonBase} cursor-pointer border-slate-950 bg-slate-950 text-white hover:bg-slate-800`}>
                  选择音频文件
                  <input
                    className="sr-only"
                    type="file"
                    multiple
                    accept=".mp3,.wav,.m4a,.mp4,audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,video/mp4"
                    onChange={handleAudioFileChange}
                  />
                </label>
              </div>
              {activeRecord.id !== emptyRecord.id ? <TaskInfoPanel record={activeRecord} /> : null}
            </section>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(380px,5fr)]">
              <div>
                <EditablePanel
                  label="转写文本"
                  helper="会议录音转成文字后会显示在这里，可直接修正错字和表达。"
                  minHeight="min-h-[590px]"
                  value={activeRecord.transcript}
                  placeholder="等待上传录音后生成转写文本"
                  copyLabel="复制"
                  onCopy={() => copyText("转写文本", activeRecord.transcript)}
                  onChange={(value) => updateRecord("transcript", value)}
                />
              </div>

              <div className="space-y-5">
                <EditablePanel
                  label="会议纪要"
                  helper="根据转写内容整理出的结构化纪要，可继续编辑。"
                  minHeight="min-h-[300px]"
                  value={activeRecord.summary}
                  placeholder="等待生成会议纪要"
                  copyLabel="复制"
                  onCopy={() => copyText("会议纪要", activeRecord.summary)}
                  onChange={(value) => updateRecord("summary", value)}
                />

                <EditablePanel
                  label="会议大纲"
                  helper="用于后续汇报或整理材料的正式大纲，可按需要调整。"
                  minHeight="min-h-[300px]"
                  value={activeRecord.outline}
                  placeholder="等待生成会议大纲"
                  copyLabel="复制"
                  onCopy={() => copyText("会议大纲", activeRecord.outline)}
                  onChange={(value) => updateRecord("outline", value)}
                />
              </div>
            </div>
            <footer className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-5">
              <button
                className={`${buttonBase} border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50`}
                type="button"
                disabled={isExportingPdf || !canExportRecord(activeRecord)}
                onClick={handleExportPdf}
              >
                {isExportingPdf ? "导出中..." : "导出 PDF"}
              </button>
              <button
                className={`${buttonBase} border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50`}
                type="button"
                disabled={isExportingWord || !canExportRecord(activeRecord)}
                onClick={handleExportWord}
              >
                {isExportingWord ? "导出中..." : "导出 Word"}
              </button>
            </footer>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function createRecordFromFile(recordId: string, title: string, file: File): MeetingRecord {
  const now = new Date().toISOString();

  return {
    id: recordId,
    title,
    createdAt: now,
    updatedAt: now,
    date: "刚刚",
    duration: "待识别",
    status: "上传中",
    taskStatus: "queued",
    transcript: "任务已创建，等待上传。\n\n系统会自动完成上传、转写、会议纪要和会议大纲生成。",
    summary: "等待生成会议纪要",
    outline: "等待生成会议大纲",
    audioFileName: file.name,
    audioFileSize: formatFileSize(file.size),
    audioFileType: file.type || getFileTypeFromName(file.name),
    audioFileSizeBytes: file.size,
    uploadProgress: 0,
    uploadNotice: "等待上传"
  };
}

function SettingsPanel({
  currentOrigin,
  form,
  settings,
  settingsStatus,
  dashscopeStatus,
  ossStatus,
  isSavingSettings,
  isTestingDashScope,
  isTestingOss,
  onChange,
  onSave,
  onTestDashScope,
  onTestOss,
  onClose
}: {
  currentOrigin: string;
  form: SettingsForm;
  settings: PublicRuntimeConfig | null;
  settingsStatus: string;
  dashscopeStatus: ConfigDisplayStatus;
  ossStatus: ConfigDisplayStatus;
  isSavingSettings: boolean;
  isTestingDashScope: boolean;
  isTestingOss: boolean;
  onChange: (patch: Partial<SettingsForm>) => void;
  onSave: () => void;
  onTestDashScope: () => void;
  onTestOss: () => void;
  onClose: () => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">初始化设置</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">系统配置</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            请填写客户自己的阿里云百炼 API Key 和 OSS 配置。配置会保存到本机后端，不会放在浏览器缓存里。
          </p>
        </div>
        <button
          className={`${buttonBase} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
          type="button"
          onClick={onClose}
        >
          返回主界面
        </button>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <h3 className="text-base font-semibold text-slate-950">百炼 / DashScope</h3>
          <p className="mt-2 text-sm text-slate-600">
            当前状态：{dashscopeStatus}
          </p>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            DASHSCOPE_API_KEY
            <input
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              type="password"
              value={form.dashscopeApiKey}
              placeholder={settings?.dashscopeApiKeySaved ? "已配置，留空则保留" : "请输入百炼 API Key"}
              onChange={(event) => onChange({ dashscopeApiKey: event.target.value })}
            />
          </label>
          <button
            className={`${buttonBase} mt-4 border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
            type="button"
            disabled={isTestingDashScope}
            onClick={onTestDashScope}
          >
            {isTestingDashScope ? "测试中..." : "测试百炼 API"}
          </button>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
          <h3 className="text-base font-semibold text-slate-950">OSS 前端直传</h3>
          <p className="mt-2 text-sm text-slate-600">当前状态：{ossStatus}</p>
          <label className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.ossEnabled}
              onChange={(event) => onChange({ ossEnabled: event.target.checked })}
            />
            启用 OSS 上传
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            OSS_REGION
            <select
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              value={form.ossRegion}
              onChange={(event) => onChange({ ossRegion: event.target.value })}
            >
              {ossRegionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            OSS_BUCKET
            <input
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              type="text"
              value={form.ossBucket}
              placeholder="请输入您的 OSS Bucket 名称"
              onChange={(event) => onChange({ ossBucket: event.target.value })}
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            OSS_ACCESS_KEY_ID
            <input
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              type="password"
              value={form.ossAccessKeyId}
              placeholder={settings?.ossAccessKeyIdSaved ? "已配置，留空则保留" : "请输入 OSS AccessKey ID"}
              onChange={(event) => onChange({ ossAccessKeyId: event.target.value })}
            />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            OSS_ACCESS_KEY_SECRET
            <input
              className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              type="password"
              value={form.ossAccessKeySecret}
              placeholder={settings?.ossAccessKeySecretSaved ? "已配置，留空则保留" : "请输入 OSS AccessKey Secret"}
              onChange={(event) => onChange({ ossAccessKeySecret: event.target.value })}
            />
          </label>
          <button
            className={`${buttonBase} mt-4 border-slate-200 bg-white text-slate-700 hover:bg-slate-50`}
            type="button"
            disabled={isTestingOss}
            onClick={onTestOss}
          >
            {isTestingOss ? "测试中..." : "测试 OSS 上传"}
          </button>
        </section>
      </div>

      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
        <p className="font-medium text-slate-950">OSS CORS 提示</p>
        <p className="mt-1">如使用 OSS 前端直传，请在阿里云 OSS 控制台配置 CORS。</p>
        <p className="mt-1">
          请在 OSS 控制台的 CORS Origin 中添加以下地址：
          <span className="ml-1 font-medium text-slate-950">{currentOrigin || "当前访问地址"}</span>
        </p>
      </div>

      {settingsStatus ? (
        <div className="mt-5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 shadow-sm">
          {settingsStatus}
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          className={`${buttonBase} border-slate-950 bg-slate-950 text-white hover:bg-slate-800`}
          type="button"
          disabled={isSavingSettings}
          onClick={onSave}
        >
          {isSavingSettings ? "保存中..." : "保存配置"}
        </button>
      </div>
    </section>
  );
}

function TaskInfoPanel({ record }: { record: MeetingRecord }) {
  return (
    <dl className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs text-slate-500">音频文件名</dt>
        <dd className="mt-1 break-all font-medium text-slate-800">{record.audioFileName || "未选择"}</dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">文件大小</dt>
        <dd className="mt-1 font-medium text-slate-800">{record.audioFileSize || "未明确"}</dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">文件类型</dt>
        <dd className="mt-1 font-medium text-slate-800">{record.audioFileType || "未明确"}</dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">处理状态</dt>
        <dd className="mt-1">
          <StatusBadge status={record.taskStatus} label={record.status} />
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">创建时间</dt>
        <dd className="mt-1 font-medium text-slate-800">{formatDateTime(record.createdAt)}</dd>
      </div>
      {["uploading", "queued", "failed"].includes(record.taskStatus) || typeof record.uploadProgress === "number" ? (
        <div className="sm:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-xs text-slate-500">上传进度</dt>
            <dd className="text-xs font-medium text-slate-700">{record.uploadProgress ?? 0}%</dd>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-slate-950 transition-all"
              style={{ width: `${record.uploadProgress ?? 0}%` }}
            />
          </div>
          {record.uploadNotice ? <p className="mt-2 text-xs leading-5 text-slate-600">{record.uploadNotice}</p> : null}
        </div>
      ) : null}
      {record.errorMessage ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">
          {record.errorMessage}
        </div>
      ) : null}
    </dl>
  );
}

function StatusBadge({ status, label }: { status: TaskStatus; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${getStatusBadgeClass(status)}`}>
      {label}
    </span>
  );
}

function getStatusBadgeClass(status: TaskStatus) {
  if (status === "completed") {
    return "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200";
  }

  if (status === "failed") {
    return "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200";
  }

  if (status === "uploading" || status === "transcribing" || status === "summarizing" || status === "still_processing") {
    return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  }

  return "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200";
}

type WordExportTools = {
  Paragraph: new (options?: any) => any;
  TextRun: new (options?: any) => any;
  HeadingLevel: {
    HEADING_1: string;
  };
};

function createWordSection(title: string, content: string, tools: WordExportTools) {
  const { Paragraph, TextRun, HeadingLevel } = tools;
  const text = content.trim() || "暂无内容";

  return [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun(title)]
    }),
    ...text.split("\n").map(
      (line) =>
        new Paragraph({
          children: [new TextRun(line || " ")]
        })
    )
  ];
}

function createPdfExportNode(record: MeetingRecord) {
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.width = "794px";
  container.style.boxSizing = "border-box";
  container.style.padding = "48px";
  container.style.background = "#ffffff";
  container.style.color = "#111111";
  container.style.fontFamily =
    'Arial, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
  container.style.fontSize = "16px";
  container.style.lineHeight = "1.75";

  const title = document.createElement("h1");
  title.textContent = record.title;
  title.style.fontSize = "28px";
  title.style.margin = "0 0 24px";
  title.style.lineHeight = "1.35";
  container.appendChild(title);

  appendPdfSection(container, "会议纪要", record.summary);
  appendPdfSection(container, "会议大纲", record.outline);

  return container;
}

function appendPdfSection(container: HTMLDivElement, title: string, content: string) {
  const sectionTitle = document.createElement("h2");
  sectionTitle.textContent = title;
  sectionTitle.style.fontSize = "20px";
  sectionTitle.style.margin = "24px 0 8px";
  sectionTitle.style.lineHeight = "1.4";
  container.appendChild(sectionTitle);

  const body = document.createElement("div");
  body.textContent = content.trim() || "暂无内容";
  body.style.whiteSpace = "pre-wrap";
  body.style.wordBreak = "break-word";
  container.appendChild(body);
}

function canExportRecord(record: MeetingRecord) {
  return Boolean(record.title.trim() && (record.summary.trim() || record.outline.trim()));
}

function sanitizeDownloadFileName(fileName: string) {
  return (fileName || "会议记录").replace(/[\\/:*?"<>|]/g, "_").trim() || "会议记录";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

async function saveBlobWithPicker(blob: Blob, fileName: string, mimeType: string) {
  const pickerWindow = window as SaveFilePickerWindow;

  if (!pickerWindow.showSaveFilePicker) {
    downloadBlob(blob, fileName);
    return;
  }

  const extension = fileName.endsWith(".pdf") ? ".pdf" : ".docx";
  const handle = await pickerWindow.showSaveFilePicker({
    suggestedName: fileName,
    types: [
      {
        description: extension === ".pdf" ? "PDF 文件" : "Word 文档",
        accept: {
          [mimeType]: [extension]
        }
      }
    ]
  });
  const writable = await handle.createWritable();

  await writable.write(blob);
  await writable.close();
}

function isSaveCancelled(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function EditablePanel({
  label,
  helper,
  value,
  minHeight,
  placeholder,
  copyLabel,
  onCopy,
  onChange
}: {
  label: string;
  helper: string;
  value: string;
  minHeight: string;
  placeholder?: string;
  copyLabel?: string;
  onCopy?: () => void;
  onChange: (value: string) => void;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_4px_20px_rgba(0,0,0,0.03)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-normal text-slate-950">{label}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">{helper}</p>
        </div>
        {onCopy ? (
          <button
            className={`${buttonBase} shrink-0 border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50`}
            type="button"
            disabled={!value.trim()}
            onClick={onCopy}
          >
            {copyLabel ?? "复制"}
          </button>
        ) : null}
      </div>
      <textarea
        className={`w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200 ${minHeight}`}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </section>
  );
}

function readLocalRecords(retentionDays: number) {
  try {
    const savedRecords = window.localStorage.getItem(localRecordsStorageKey);

    if (!savedRecords) {
      return [];
    }

    const parsedRecords = JSON.parse(savedRecords) as MeetingRecord[];

    return Array.isArray(parsedRecords)
      ? parsedRecords.filter((record) => isRecordRetained(record, retentionDays))
      : [];
  } catch {
    return [];
  }
}

async function fetchHistoryRecords() {
  const response = await fetch("/api/history");
  const result = (await response.json()) as HistoryResponse;

  if (!response.ok || !result.ok || !Array.isArray(result.records)) {
    return [];
  }

  return result.records.map(fromStoredRecord);
}

async function createHistoryRecord(record: MeetingRecord) {
  await fetch("/api/history", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(toStoredRecord(record))
  });
}

async function updateHistoryRecord(record: MeetingRecord) {
  if (record.id === emptyRecord.id) {
    return;
  }

  await fetch(`/api/history/${encodeURIComponent(record.id)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(toStoredRecord(record))
  });
}

async function renameHistoryRecord(recordId: string, title: string) {
  await fetch(`/api/history/${encodeURIComponent(recordId)}/rename`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ title })
  });
}

async function deleteHistoryRecord(recordId: string) {
  await fetch(`/api/history/${encodeURIComponent(recordId)}`, {
    method: "DELETE"
  });
}

async function batchDeleteHistoryRecords(recordIds: string[]) {
  await fetch("/api/history/batch-delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ ids: recordIds })
  });
}

function toStoredRecord(record: MeetingRecord): StoredMeetingRecord {
  return {
    id: record.id,
    title: record.title,
    originalFileName: record.audioFileName || "",
    fileSize: record.audioFileSizeBytes,
    fileSizeLabel: record.audioFileSize || "",
    fileType: record.audioFileType || "",
    duration: record.duration || "",
    durationSeconds: record.durationSeconds,
    status: record.taskStatus,
    taskStatus: record.taskStatus,
    transcript: record.transcript || "",
    summary: record.summary || "",
    outline: record.outline || "",
    todos: "",
    errorMessage: record.errorMessage || "",
    createdAt: record.createdAt,
    updatedAt: record.updatedAt || new Date().toISOString()
  };
}

function fromStoredRecord(record: StoredMeetingRecord): MeetingRecord {
  const createdAt = record.createdAt || new Date().toISOString();

  return {
    id: record.id,
    title: record.title || "未命名会议",
    createdAt,
    updatedAt: record.updatedAt,
    date: formatDateLabel(createdAt),
    duration: record.duration || "待识别",
    status: getDisplayStatus(record.taskStatus || record.status),
    taskStatus: normalizeTaskStatus(record.taskStatus || record.status),
    transcript: record.transcript || "",
    summary: record.summary || "",
    outline: record.outline || "",
    audioFileName: record.originalFileName || "",
    audioFileSize: record.fileSizeLabel || (record.fileSize ? formatFileSize(record.fileSize) : ""),
    audioFileType: record.fileType || "",
    audioFileSizeBytes: record.fileSize,
    durationSeconds: record.durationSeconds,
    uploadProgress: record.status === "已完成" ? 100 : undefined,
    uploadNotice: "",
    errorMessage: record.errorMessage || ""
  };
}

function normalizeTaskStatus(value: string | undefined): TaskStatus {
  if (
    value === "idle" ||
    value === "queued" ||
    value === "uploading" ||
    value === "transcribing" ||
    value === "summarizing" ||
    value === "completed" ||
    value === "failed" ||
    value === "still_processing"
  ) {
    return value;
  }

  if (value?.includes("上传")) {
    return "uploading";
  }

  if (value?.includes("转写")) {
    return "transcribing";
  }

  if (value?.includes("纪要")) {
    return "summarizing";
  }

  if (value?.includes("完成")) {
    return "completed";
  }

  if (value?.includes("失败")) {
    return "failed";
  }

  return "idle";
}

function getDisplayStatus(value: string | undefined) {
  const status = normalizeTaskStatus(value);

  const labels: Record<TaskStatus, string> = {
    idle: "待处理",
    queued: "待上传",
    uploading: "上传中",
    transcribing: "转写中",
    summarizing: "生成纪要中",
    completed: "已完成",
    failed: "失败",
    still_processing: "转写中"
  };

  return labels[status];
}

function wait(milliseconds: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {
      ok: false,
      message: "服务返回内容异常，请稍后重试。"
    } as T;
  }
}

async function sendClientLog(stage: string, details: Record<string, unknown> = {}) {
  try {
    await fetch("/api/client-log", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        stage,
        ...details
      })
    });
  } catch {
    // 日志失败不影响主流程。
  }
}

function isSupportedAudioFile(file: File) {
  const supportedExtensions = [".mp3", ".wav", ".m4a", ".mp4"];
  const supportedMimeTypes = [
    "audio/mpeg",
    "audio/wav",
    "audio/x-wav",
    "audio/mp4",
    "audio/x-m4a",
    "audio/m4a",
    "video/mp4"
  ];
  const fileName = file.name.toLowerCase();

  return supportedExtensions.some((extension) => fileName.endsWith(extension)) || supportedMimeTypes.includes(file.type);
}

function isRecordRetained(record: MeetingRecord, retentionDays: number) {
  const createdAt = new Date(record.createdAt).getTime();

  if (!Number.isFinite(createdAt)) {
    return true;
  }

  return Date.now() - createdAt <= retentionDays * 24 * 60 * 60 * 1000;
}

function readAudioDuration(file: File) {
  return new Promise<number | null>((resolve) => {
    const media = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);

    media.preload = "metadata";
    media.onloadedmetadata = () => {
      const duration = Number.isFinite(media.duration) ? media.duration : null;
      URL.revokeObjectURL(objectUrl);
      resolve(duration);
    };
    media.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    media.src = objectUrl;
  });
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds: number) {
  const roundedSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }

  return `${Math.max(1, minutes)} 分钟`;
}

function formatElapsedTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) {
    return `${seconds} 秒`;
  }

  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分钟`;
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "未明确";
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDateLabel(value: string) {
  const date = new Date(value);
  const now = Date.now();

  if (!Number.isFinite(date.getTime())) {
    return "刚刚";
  }

  if (now - date.getTime() < 24 * 60 * 60 * 1000) {
    return "今天";
  }

  return date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  });
}

function getFriendlyTranscribeError(message?: string) {
  if (message?.includes("API Key") || message?.includes("api key") || message?.includes("密钥")) {
    return "未检测到阿里云 API Key，请检查 .env.local 配置。";
  }

  if (message?.includes("格式") || message?.includes("format")) {
    return "音频格式暂不支持，请尝试 mp3、wav、m4a 或 mp4 文件。";
  }

  return "转写失败，请重试或检查音频文件。";
}

function getMissingSettingsFields(form: SettingsForm, settings: PublicRuntimeConfig | null) {
  const missingFields: string[] = [];

  if (!form.dashscopeApiKey.trim() && !settings?.dashscopeApiKeySaved) {
    missingFields.push("DASHSCOPE_API_KEY");
  }

  if (form.ossEnabled) {
    if (!form.ossRegion.trim()) {
      missingFields.push("OSS_REGION");
    }

    if (!form.ossBucket.trim()) {
      missingFields.push("OSS_BUCKET");
    }

    if (!form.ossAccessKeyId.trim() && !settings?.ossAccessKeyIdSaved) {
      missingFields.push("OSS_ACCESS_KEY_ID");
    }

    if (!form.ossAccessKeySecret.trim() && !settings?.ossAccessKeySecretSaved) {
      missingFields.push("OSS_ACCESS_KEY_SECRET");
    }
  }

  return missingFields;
}

function getFriendlyGenerateError(message?: string) {
  if (message?.includes("API Key") || message?.includes("api key") || message?.includes("密钥")) {
    return "未检测到大模型 API Key，请检查 .env.local 配置。";
  }

  return "会议纪要生成失败，请稍后重试。";
}

function getFriendlyOssError(responseText?: string) {
  const ossCode = getOssErrorCode(responseText);

  if (ossCode === "UserDisable") {
    return "OSS 上传失败：当前 OSS 账号或服务不可用，请检查阿里云 OSS 是否已开通、是否欠费，或 AccessKey/RAM 用户是否被禁用。";
  }

  if (ossCode === "AccessDenied") {
    return "OSS 上传失败：当前 AccessKey 没有上传权限，请检查 Bucket 权限或 RAM 授权。";
  }

  if (ossCode === "NoSuchBucket") {
    return "OSS 上传失败：没有找到当前 Bucket，请检查 OSS_BUCKET 和 OSS_REGION 配置。";
  }

  return "OSS 直传失败，请检查 OSS 配置、Bucket CORS 或网络后重试。";
}

function getOssErrorCode(responseText?: string) {
  if (!responseText) {
    return null;
  }

  return responseText.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? null;
}

function getFileTypeFromName(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();

  if (!extension) {
    return "未知音频类型";
  }

  if (extension === "mp4") {
    return "MP4 音频/视频";
  }

  return `${extension.toUpperCase()} 音频`;
}
