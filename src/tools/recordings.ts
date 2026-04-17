import { zodToJsonSchema } from "zod-to-json-schema";
import { v4 as uuidv4 } from "uuid";

import {
  SaveRecordingTool,
  ListRecordingsTool,
  GetRecordingTool,
  DeleteRecordingTool,
  StartSessionRecordingTool,
  StopSessionRecordingTool,
} from "@/types/tool-schemas";
import { jsonResponse, errorResponse } from "@/utils/response-helpers";
import { mongodb } from "@/utils/mongodb";

import { Tool } from "./tool";

/**
 * Save a user interaction recording to MongoDB
 */
export const saveRecording: Tool = {
  schema: {
    name: SaveRecordingTool.shape.name.value,
    description: SaveRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema(SaveRecordingTool.shape.arguments),
  },
  handle: async (_context, params) => {
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }

      const validatedParams = SaveRecordingTool.shape.arguments.parse(params);
      const recordings = mongodb.getRecordingsCollection();

      const now = new Date();
      const recordingDoc = {
        id: uuidv4(),
        sessionId: validatedParams.sessionId,
        title: validatedParams.title,
        description: validatedParams.description || "",
        tags: validatedParams.tags || [],
        startUrl: validatedParams.startUrl || "",
        createdAt: now,
        startTime: validatedParams.startTime,
        endTime: validatedParams.endTime,
        duration: validatedParams.duration,
        stepCount: validatedParams.steps.length,
        steps: validatedParams.steps,
      };

      await recordings.insertOne(recordingDoc);

      return jsonResponse({
        success: true,
        id: recordingDoc.id,
        message: `Recording "${validatedParams.title}" saved successfully`,
      });
    } catch (error) {
      return errorResponse(`Failed to save recording: ${error.message}`, false, error);
    }
  },
};

/**
 * List saved recordings with optional filtering
 */
export const listRecordings: Tool = {
  schema: {
    name: ListRecordingsTool.shape.name.value,
    description: ListRecordingsTool.shape.description.value,
    inputSchema: zodToJsonSchema(ListRecordingsTool.shape.arguments),
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }

      const validatedParams = ListRecordingsTool.shape.arguments.parse(params || {});
      const recordings = mongodb.getRecordingsCollection();

      const query: any = {};

      if (validatedParams.tags && validatedParams.tags.length > 0) {
        query.tags = { $in: validatedParams.tags };
      }

      if (validatedParams.startUrl) {
        query.startUrl = { $regex: validatedParams.startUrl, $options: "i" };
      }

      if (validatedParams.search) {
        query.$or = [
          { title: { $regex: validatedParams.search, $options: "i" } },
          { description: { $regex: validatedParams.search, $options: "i" } },
        ];
      }

      const limit = validatedParams.limit || 50;

      const results = await recordings
        .find(query, {
          projection: {
            _id: 0,
            steps: 0, // Exclude steps from list results
          },
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();

      return jsonResponse({ count: results.length, recordings: results }, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to list recordings: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Get a recording by ID including all steps
 */
export const getRecording: Tool = {
  schema: {
    name: GetRecordingTool.shape.name.value,
    description: GetRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema(GetRecordingTool.shape.arguments),
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }

      const validatedParams = GetRecordingTool.shape.arguments.parse(params);
      const recordings = mongodb.getRecordingsCollection();

      const recording = await recordings.findOne(
        { id: validatedParams.id },
        { projection: { _id: 0 } }
      );

      if (!recording) {
        return errorResponse(`Recording with ID "${validatedParams.id}" not found`, true, undefined, max_tokens);
      }

      return jsonResponse({ recording }, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to get recording: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Start a rich session recording (rrweb + network + video) — delegates to extension
 */
export const startSessionRecording: Tool = {
  schema: {
    name: StartSessionRecordingTool.shape.name.value,
    description: StartSessionRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema(StartSessionRecordingTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const result = await context.sendSocketMessage("browser_start_session_recording", {});
      return jsonResponse(result, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to start session recording: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Stop the active session recording and save to server
 */
export const stopSessionRecording: Tool = {
  schema: {
    name: StopSessionRecordingTool.shape.name.value,
    description: StopSessionRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema(StopSessionRecordingTool.shape.arguments),
  },
  handle: async (context, params) => {
    const { max_tokens } = params || {};
    try {
      const result = await context.sendSocketMessage("browser_stop_session_recording", {});
      return jsonResponse(result, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to stop session recording: ${error.message}`, false, error, max_tokens);
    }
  },
};

/**
 * Delete a recording by ID
 */
export const deleteRecording: Tool = {
  schema: {
    name: DeleteRecordingTool.shape.name.value,
    description: DeleteRecordingTool.shape.description.value,
    inputSchema: zodToJsonSchema(DeleteRecordingTool.shape.arguments),
  },
  handle: async (_context, params) => {
    const { max_tokens } = params || {};
    try {
      if (!mongodb.isConnected()) {
        await mongodb.connect();
      }

      const validatedParams = DeleteRecordingTool.shape.arguments.parse(params);
      const recordings = mongodb.getRecordingsCollection();

      const existing = await recordings.findOne({ id: validatedParams.id });
      if (!existing) {
        return errorResponse(`Recording with ID "${validatedParams.id}" not found`, true, undefined, max_tokens);
      }

      await recordings.deleteOne({ id: validatedParams.id });

      return jsonResponse({
        success: true,
        message: `Recording "${existing.title}" deleted successfully`,
        id: existing.id,
      }, max_tokens);
    } catch (error) {
      return errorResponse(`Failed to delete recording: ${error.message}`, false, error, max_tokens);
    }
  },
};
