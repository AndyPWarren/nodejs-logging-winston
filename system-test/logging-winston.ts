/*!
 * Copyright 2016 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as assert from 'assert';
import * as uuid from 'uuid';

import * as types from '../src/types/core';

import {ErrorsApiTransport} from './errors-transport';

const inject = require('require-inject');

const winston3 = require('winston');
const winston2 = require('../../test/winston-2/node_modules/winston');

const {Logging} = require('@google-cloud/logging');
const logging = new Logging();
const LoggingWinston = require('../src/index').LoggingWinston;

const WRITE_CONSISTENCY_DELAY_MS = 90000;

const UUID = uuid.v4();
function logName(name: string) {
  return `${UUID}_${name}`;
}

describe('LoggingWinston', () => {
  const testTimestamp = new Date();

  // type TestData

  const commonTestData: TestData[] = [
    {
      args: ['first'],
      level: 'info',
      verify: (entry: types.StackdriverEntry) => {
        assert.deepStrictEqual(entry.data, {
          message: 'first',
          metadata: {},
        });
      },
    },

    {
      args: ['second'],
      level: 'info',
      verify: (entry: types.StackdriverEntry) => {
        assert.deepStrictEqual(entry.data, {
          message: 'second',
          metadata: {},
        });
      },
    },
    {
      args: ['third', {testTimestamp}],
      level: 'info',
      verify: (entry: types.StackdriverEntry) => {
        assert.deepStrictEqual(entry.data, {
          message: 'third',
          metadata: {
            testTimestamp: String(testTimestamp),
          },
        });
      },
    }
  ];

  type TestData = {
    // tslint:disable-next-line:no-any
    args: any[]; level: string; verify: (entry: types.StackdriverEntry) => void;
  };

  describe('log winston 2', () => {
    const testData = commonTestData.concat([
      {
        args: [new Error('fourth')],
        level: 'error',
        verify: (entry: types.StackdriverEntry) => {
          assert((entry.data as {
                   message: string
                 }).message.startsWith('Error: fourth'));
        },
      },
      {
        args: ['fifth message', new Error('fifth')],
        level: 'error',
        verify: (entry: types.StackdriverEntry) => {
          assert((entry.data as {
                   message: string
                 }).message.startsWith('fifth message Error: fifth'));
        },
      },
    ] as typeof commonTestData);

    const LOG_NAME = logName('logging_winston_2_system_tests');
    const LoggingWinston = inject('../src/index', {
                             winston: winston2,
                             'winston/package.json': {version: '2.2.0'}
                           }).LoggingWinston;

    const logger = new winston2.Logger({
      transports: [new LoggingWinston({logName: LOG_NAME})],
    });

    it('should properly write log entries', async () => {
      const start = Date.now();
      testData.forEach((test) => {
        // logger does not have index signature.
        // tslint:disable-next-line:no-any
        (logger as any)[test.level].apply(logger, test.args);
      });

      const entries = await pollLogs(
          LOG_NAME, start, testData.length, WRITE_CONSISTENCY_DELAY_MS);
      assert.strictEqual(entries.length, testData.length);
      entries.reverse().forEach((entry, index) => {
        const test = testData[index];
        test.verify(entry);
      });
    });
  });


  describe('log winston 3', () => {
    const testData = commonTestData.concat([
      {
        args: [new Error('fourth')],
        level: 'error',
        verify: (entry: types.StackdriverEntry) => {
          assert((entry.data as {
                   message: string
                 }).message.startsWith('fourth Error:'));
        },
      },
      {
        args: [{
          level: 'error',
          message: 'fifth message',
          error: new Error('fifth')
        }],
        level: 'log',
        verify: (entry: types.StackdriverEntry) => {
          assert((entry.data as {
                   message: string
                 }).message.startsWith('fifth message'));
        },
      },
    ] as TestData[]);

    const LOG_NAME = logName('logging_winston_3_system_tests');
    const LoggingWinston = inject('../src/index', {
                             winston: winston3,
                             'winston/package.json': {version: '3.0.0'}
                           }).LoggingWinston;

    const logger = winston3.createLogger({
      transports: [new LoggingWinston({logName: LOG_NAME})],
    });

    it('should properly write log entries', async () => {
      const start = Date.now();
      testData.forEach((test) => {
        // logger does not have index signature.
        // tslint:disable-next-line:no-any
        (logger as any)[test.level].apply(logger, test.args);
      });

      const entries = await pollLogs(
          LOG_NAME, start, testData.length, WRITE_CONSISTENCY_DELAY_MS);
      assert.strictEqual(entries.length, testData.length);
      entries.reverse().forEach((entry, index) => {
        const test = testData[index];
        test.verify(entry);
      });
    });
  });

  describe('ErrorReporting', () => {
    const LOG_NAME = logName('logging_winston_error_reporting_system_tests');
    const ERROR_REPORTING_POLL_TIMEOUT = WRITE_CONSISTENCY_DELAY_MS;
    const errorsTransport = new ErrorsApiTransport();

    beforeEach(async function() {
      this.timeout(WRITE_CONSISTENCY_DELAY_MS);
    });

    after(async () => {
      await errorsTransport.deleteAllEvents();
    });

    it('reports errors when logging errors with winston2', async () => {
      const start = Date.now();
      const service = 'logging-winston-system-test';
      const LoggingWinston = inject('../src/index', {
                               winston: winston2,
                               'winston/package.json': {version: '2.2.0'}
                             }).LoggingWinston;

      const logger = new winston2.Logger({
        transports: [new LoggingWinston(
            {logName: LOG_NAME, serviceContext: {service, version: 'none'}})],
      });

      const message = `an error at ${Date.now()}`;

      logger.error('an error', new Error(message));

      const errors = await errorsTransport.pollForNewEvents(
          service, start, ERROR_REPORTING_POLL_TIMEOUT);

      assert.strictEqual(errors.length, 1);
      const errEvent = errors[0];

      assert.strictEqual(
          errEvent.serviceContext.service, 'logging-winston-system-test');
      assert(errEvent.message.startsWith(`an error Error: ${message}`));
    });

    it('reports errors when logging errors with winston3', async () => {
      const start = Date.now();
      const service = 'logging-winston-system-test-winston3';
      const LoggingWinston = inject('../src/index', {
                               winston: winston3,
                               'winston/package.json': {version: '3.0.0'}
                             }).LoggingWinston;

      const logger = winston3.createLogger({
        transports: [new LoggingWinston(
            {logName: LOG_NAME, serviceContext: {service, version: 'none'}})],
      });

      const message = `an error at ${Date.now()}`;

      logger.error(new Error(message));

      const errors = await errorsTransport.pollForNewEvents(
          service, start, ERROR_REPORTING_POLL_TIMEOUT);

      assert.strictEqual(errors.length, 1);
      const errEvent = errors[0];

      assert.strictEqual(
          errEvent.serviceContext.service,
          'logging-winston-system-test-winston3');

      assert(errEvent.message.startsWith(message));
    });
  });
});

// polls for the entire array of entries to be greater than logTime.
function pollLogs(
    logName: string, logTime: number, size: number, timeout: number) {
  const p = new Promise<types.StackdriverEntry[]>((resolve, reject) => {
    const end = Date.now() + timeout;
    loop();

    function loop() {
      setTimeout(() => {
        logging.log(logName).getEntries(
            {
              pageSize: size,
            },
            (err: Error, entries: types.StackdriverEntry[]) => {
              if (!entries || entries.length < size) return loop();

              const {receiveTimestamp} =
                  (entries[entries.length - 1].metadata || {}) as
                  {receiveTimestamp: {seconds: number, nanos: number}};
              const timeMilliseconds = (receiveTimestamp.seconds * 1000) +
                  (receiveTimestamp.nanos * 1e-6);

              if (timeMilliseconds >= logTime) {
                return resolve(entries);
              }

              if (Date.now() > end) {
                return reject(new Error('timeout'));
              }
              loop();
            });
      }, 500);
    }
  });

  return p;
}
