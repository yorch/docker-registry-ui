import { RequestPool, MAX_CONCURRENT_REQUESTS } from '../src/scripts/request-pool.js';
import assert from 'node:assert';

// Each task records that it started and hands back its `done` so the test
// decides when it finishes.
const trackingTask = (log, id) => {
  const task = { id, done: undefined, started: false };
  task.run = (done) => {
    task.started = true;
    task.done = done;
    log.push(id);
  };
  return task;
};

describe('request-pool', () => {
  it('should cap how many tasks run at once', () => {
    const pool = new RequestPool(3);
    const log = [];
    const tasks = [0, 1, 2, 3, 4].map((i) => trackingTask(log, i));
    tasks.forEach((task) => pool.submit(task.run));
    assert.deepEqual(log, [0, 1, 2]);
  });

  it('should start the next task when a slot frees', () => {
    const pool = new RequestPool(2);
    const log = [];
    const tasks = [0, 1, 2, 3].map((i) => trackingTask(log, i));
    tasks.forEach((task) => pool.submit(task.run));
    assert.deepEqual(log, [0, 1]);
    tasks[0].done();
    assert.deepEqual(log, [0, 1, 2]);
    tasks[1].done();
    assert.deepEqual(log, [0, 1, 2, 3]);
  });

  it('should run queued tasks in submission order', () => {
    const pool = new RequestPool(1);
    const log = [];
    const tasks = [0, 1, 2].map((i) => trackingTask(log, i));
    tasks.forEach((task) => pool.submit(task.run));
    tasks[0].done();
    tasks[1].done();
    assert.deepEqual(log, [0, 1, 2]);
  });

  // A cache hit replays synchronously, so `done` can be called during submit()
  // itself, before the pool has finished bookkeeping for that task.
  it('should handle a task that completes synchronously', () => {
    const pool = new RequestPool(2);
    const log = [];
    [0, 1, 2, 3].forEach((i) =>
      pool.submit((done) => {
        log.push(i);
        done();
      }),
    );
    assert.deepEqual(log, [0, 1, 2, 3], 'every task should run when each finishes immediately');
    assert.equal(pool.active, 0);
  });

  // XHR fires loadend once, but the auth retry path and defensive callers can
  // double-call. A second call must not hand out an extra slot.
  it('should ignore a done that is called twice', () => {
    const pool = new RequestPool(1);
    const log = [];
    const tasks = [0, 1, 2].map((i) => trackingTask(log, i));
    tasks.forEach((task) => pool.submit(task.run));
    tasks[0].done();
    tasks[0].done();
    assert.deepEqual(log, [0, 1], 'the duplicate call should not start a third task');
    assert.equal(pool.active, 1);
  });

  it('should keep running when a task throws', () => {
    const pool = new RequestPool(1);
    const log = [];
    pool.submit(() => {
      throw new Error('task blew up');
    });
    pool.submit((done) => {
      log.push('after');
      done();
    });
    assert.deepEqual(log, ['after'], 'a throwing task must release its slot');
  });

  describe('drop', () => {
    it('should discard queued tasks that have not started', () => {
      const pool = new RequestPool(1);
      const log = [];
      const tasks = [0, 1, 2].map((i) => trackingTask(log, i));
      tasks.forEach((task) => pool.submit(task.run));
      pool.drop();
      tasks[0].done();
      assert.deepEqual(log, [0], 'queued tasks should never start after a drop');
    });

    it('should leave a task that is already running alone', () => {
      const pool = new RequestPool(1);
      const log = [];
      const tasks = [0, 1].map((i) => trackingTask(log, i));
      tasks.forEach((task) => pool.submit(task.run));
      pool.drop();
      assert.ok(tasks[0].started, 'the in-flight task keeps running');
      assert.equal(pool.active, 1);
    });

    it('should accept new work after a drop', () => {
      const pool = new RequestPool(1);
      const log = [];
      const tasks = [0, 1].map((i) => trackingTask(log, i));
      tasks.forEach((task) => pool.submit(task.run));
      pool.drop();
      tasks[0].done();
      pool.submit((done) => {
        log.push('fresh');
        done();
      });
      assert.deepEqual(log, [0, 'fresh']);
    });
  });

  it('should default to a sensible concurrency cap', () => {
    assert.equal(MAX_CONCURRENT_REQUESTS, 6);
    assert.equal(new RequestPool().limit, MAX_CONCURRENT_REQUESTS);
  });
});
