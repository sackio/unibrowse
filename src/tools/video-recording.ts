import { zodToJsonSchema } from "zod-to-json-schema";
import * as fs from "fs";

import {
  StartVideoRecordingTool,
  StopVideoRecordingTool,
} from "@/types/tool-schemas";
import { textResponse, errorResponse } from "@/utils/response-helpers";

import type { Tool } from "./tool";

/**
 * Start recording video of the current tab
 * Uses Chrome's tabCapture API to capture a WebM video stream of the visible tab.
 * While recording is active, all browser interaction tools produce visible on-screen
 * actions that are captured in the video — making it easy to script demonstrations.
 */
export const startVideoRecording: Tool = {
  schema: {
    name: StartVideoRecordingTool.shape.name.value,
    description: StartVideoRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema(StartVideoRecordingTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      await context.ensureAttached();
      const validatedParams = StartVideoRecordingTool.shape.arguments.parse(params);

      const result = await context.sendSocketMessage("browser_start_video_recording", validatedParams);

      return textResponse(result.message || `Video recording started`, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to start video recording: ${error.message}`, false, error, params?.max_tokens);
    }
  },
};

/**
 * Stop video recording and save to file
 * Finalizes the WebM stream and writes the video to disk.
 * Returns the file path for downstream use (ffmpeg conversion, upload, etc.).
 */
export const stopVideoRecording: Tool = {
  schema: {
    name: StopVideoRecordingTool.shape.name.value,
    description: StopVideoRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema(StopVideoRecordingTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const validatedParams = StopVideoRecordingTool.shape.arguments.parse(params);

      const result = await context.sendSocketMessage("browser_stop_video_recording", {});

      if (!result.videoBase64) {
        throw new Error("No video data returned from extension");
      }

      const outputPath = validatedParams.output_path
        || `/tmp/unibrowse_video_${Date.now()}.webm`;

      const videoBuffer = Buffer.from(result.videoBase64, "base64");
      fs.writeFileSync(outputPath, videoBuffer);

      const sizeMB = (result.byteLength / (1024 * 1024)).toFixed(2);
      return textResponse(
        `Video recording saved to: ${outputPath}\nSize: ${sizeMB} MB (${result.byteLength} bytes)\nFormat: ${result.mimeType || "video/webm"}`,
        max_tokens
      );
    } catch (error) {
      return errorResponse(`Failed to stop video recording: ${error.message}`, false, error, params?.max_tokens);
    }
  },
};
