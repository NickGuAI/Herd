#!/usr/bin/env node
import { runCli } from '@gehirn/herd-cli'

process.exitCode = await runCli(process.argv.slice(2))
