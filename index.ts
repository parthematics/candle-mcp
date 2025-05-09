#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import dotenv from "dotenv";

dotenv.config();

const TRIEVE_API_URL = process.env.TRIEVE_API_URL;
const TRIEVE_API_KEY = process.env.TRIEVE_API_KEY;
const TRIEVE_DATASET_ID = process.env.TRIEVE_DATASET_ID;
const TRIEVE_ORG_ID = process.env.TRIEVE_ORG_ID;

async function searchSimilarQuestions(query: string): Promise<any[]> {
  const response = await fetch(`${TRIEVE_API_URL}/chunk/search`, {
    method: "POST",
    headers: {
      Authorization: TRIEVE_API_KEY!,
      "TR-Dataset": TRIEVE_DATASET_ID!,
      "TR-Organization": TRIEVE_ORG_ID!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      filters: {},
      page: 1,
      page_size: 5,
      typo_options: {
        correct_typos: true,
      },
      query: query,
      search_type: "hybrid",
      use_weights: true,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Trieve API error: ${response.statusText} ${response.status}`
    );
  }

  const data = await response.json();

  return data.chunks.map((chunk: any) => ({
    id: chunk.chunk.tracking_id,
    questionType: (chunk.chunk.metadata || {})?.questionType,
    category: (chunk.chunk.metadata || {})?.category,
    text: (chunk.chunk.metadata || {})?.content,
    score: chunk.score,
  }));
}

// Tool metadata definition
const searchSimilarQuestionsTool: Tool = {
  name: "searchSimilarQuestions",
  description:
    "Finds similar questions from a structured corpus of relationship prompts.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "A question, phrase, or theme to search related prompts for",
      },
    },
    required: ["query"],
  },
};

const bulkSearchTopSimilarQuestionsTool: Tool = {
  name: "bulkSearchTopSimilarQuestions",
  description:
    "Finds similar questions from a structured corpus of relationship prompts.",
  inputSchema: {
    type: "object",
    properties: {
      queries: {
        type: "array",
        items: {
          type: "string",
          description:
            "A question, phrase, or theme to search related prompts for",
        },
      },
      limit: {
        type: "number",
        description: "The number of results to return",
        default: 3,
      },
    },
    required: ["queries", "limit"],
  },
};

// Tool handler
async function handleSearchSimilarQuestionsTool(query: string) {
  const results = await searchSimilarQuestions(query);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(results, null, 2),
      },
    ],
    isError: false,
  };
}

async function handleBulkSearchTopSimilarQuestionsTool(
  queries: string[],
  limit: number = 3
): Promise<
  Record<string, Array<{ text: string; score: number; category?: string }>>
> {
  const results: Record<
    string,
    Array<{ text: string; score: number; category?: string }>
  > = {};

  // Process queries in parallel for better performance
  const searchPromises = queries.map(async (query) => {
    try {
      const searchResults = await searchSimilarQuestions(query);
      // Return top N most similar questions for each query
      results[query] = searchResults
        .sort((a, b) => b.score - a.score) // Sort by score descending
        .slice(0, limit) // Take only top N results
        .map((result) => ({
          text: result.text,
          score: result.score,
          category: result.category,
        }));
    } catch (error) {
      console.error(`Error searching for query "${query}":`, error);
      results[query] = [];
    }
  });

  await Promise.all(searchPromises);
  return results;
}

async function main() {
  const transport = new StdioServerTransport();
  const server = new Server(
    {
      name: "candle-question-search",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // list tools endpoint
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [searchSimilarQuestionsTool, bulkSearchTopSimilarQuestionsTool],
  }));

  // call tool endpoint
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      switch (request.params.name) {
        case "searchSimilarQuestions": {
          const { query } = request.params.arguments as { query: string };
          return await handleSearchSimilarQuestionsTool(query);
        }
        case "bulkSearchTopSimilarQuestions": {
          const { queries } = request.params.arguments as {
            queries: string[];
          };
          return await handleBulkSearchTopSimilarQuestionsTool(queries);
        }
        default:
          return {
            content: [
              {
                type: "text",
                text: `Unknown tool: ${request.params.name}`,
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
        isError: true,
      };
    }
  });

  await server.connect(transport);
  console.error("🧠 Relationship Prompt MCP Server running via stdio");
}

main().catch((error) => {
  console.error("💥 Fatal error running server:", error);
  process.exit(1);
});
