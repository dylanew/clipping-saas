import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false, // don't generate AGENTS.md; CLAUDE.md is the project's instructions file
};

export default nextConfig;
