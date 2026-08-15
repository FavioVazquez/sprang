import type { ParsedSymbols } from './index.js';

/**
 * Terraform blocks.
 *
 * Infrastructure is part of the system's architecture, and `.tf` was mapped to
 * a language with no parser. Resources, data sources and modules become
 * "classes" (named things others reference); variables and outputs become
 * "functions" (the interface of the module).
 */
export function parseTerraform(source: string): ParsedSymbols {
  const functions: ParsedSymbols['functions'] = [];
  const classes: ParsedSymbols['classes'] = [];
  const lines = source.split('\n');

  // resource "aws_s3_bucket" "logs" {   /   data "aws_ami" "ubuntu" {
  const twoLabelRe = /^\s*(resource|data)\s+"([^"]+)"\s+"([^"]+)"\s*\{/;
  // module "vpc" {   /   provider "aws" {
  const oneLabelRe = /^\s*(module|provider)\s+"([^"]+)"\s*\{/;
  // variable "region" {   /   output "arn" {
  const ioRe = /^\s*(variable|output|locals)\s*"?([^"\s{]*)"?\s*\{/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*#|^\s*\/\//.test(line)) continue;

    const two = twoLabelRe.exec(line);
    if (two) {
      // aws_s3_bucket.logs — the address Terraform itself uses.
      classes.push({ name: `${two[2]}.${two[3]}`, startLine: i + 1, exported: true });
      continue;
    }
    const one = oneLabelRe.exec(line);
    if (one) {
      classes.push({ name: `${one[1]}.${one[2]}`, startLine: i + 1, exported: true });
      continue;
    }
    const io = ioRe.exec(line);
    if (io) {
      const name = io[2] ? `${io[1]}.${io[2]}` : io[1] ?? '';
      if (name) functions.push({ name, startLine: i + 1, exported: true, isAsync: false });
    }
  }

  return { functions, classes };
}
