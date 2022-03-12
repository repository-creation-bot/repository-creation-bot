import * as process from 'process'
import * as cp from 'child_process'
import * as path from 'path'
import {expect, test} from '@jest/globals'
import {toKebabCase} from '../src/parse'

// shows how the runner will run a javascript action with env / stdout protocol
test('test kebab', () => {
  expect(toKebabCase('lowercase')).toEqual('lowercase');
  expect(toKebabCase('lowercase01')).toEqual('lowercase01');
  expect(toKebabCase('lowercase01-kebab02')).toEqual('lowercase01-kebab02');
  expect(toKebabCase('PascalCase')).toEqual('pascal-case');
  expect(toKebabCase('PascalCase01')).toEqual('pascal-case01');
  expect(toKebabCase('Pascal01Case02')).toEqual('pascal01-case02');
  expect(toKebabCase('UPPERCASE')).toEqual('uppercase');
  expect(toKebabCase('with spaces')).toEqual('with-spaces');
  expect(toKebabCase('with   spaces')).toEqual('with-spaces');
})

test('test runs', () => {
  process.env['INPUT_ORG_ADMINS'] = 'repository-creation-bot/org-admins'
  process.env['INPUT_TOKEN'] = 'pat'
  process.env['INPUT_EVENT_NAME'] = 'issues'
  process.env['INPUT_EVENT'] = '{}'
  const np = process.execPath
  const ip = path.join(__dirname, '..', 'lib', 'main.js')
  const options: cp.ExecFileSyncOptions = {
    env: process.env
  }
  console.log(cp.execFileSync(np, [ip], options).toString())
})
