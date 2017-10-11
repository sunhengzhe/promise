const isCallable = require('is-callable');

function isObject (obj) {
    return typeof obj === 'object';
}

function IsPromise (promise) {
    return promise instanceof Promise;
}

function Promise (executor) {
    if (!new.target) {
        throw new TypeError('undefined is not a promise');
    }

    if (!isCallable(executor)) {
        throw new TypeError(`Promise resolver ${executor} is not a function`);
    }

    const promise = Object.create(new.target.prototype, {
        PromiseState: {
            value: 'pending',
            writable: true
        },
        PromiseFulfillReactions: {
            value: []
        },
        PromiseRejectReactions: {
            value: []
        },
        PromiseIsHandled: {
            value: false,
            writable: true
        }
    });

    const resolvingFunctions = CreateResolvingFunctions(promise);

    try {
        executor.call(undefined, resolvingFunctions.Resolve, resolvingFunctions.Reject);
    } catch (err) {
        resolvingFunctions.Reject.call(undefined, err);
    }

    return promise;
}

Promise.prototype.then = function (onFulfilled, onRejected) {
    const promise = this;
    if (!IsPromise(promise)) {
        throw new TypeError('!IsPromise(promise)');
    }

    // 创建一个新的 promise 用于 promise chain 的后续执行
    const resultCapability = NewPromiseCapability();
    return PerformPromiseThen(promise, onFulfilled, onRejected, resultCapability);
}

Promise.resolve = function (x) {
    const promiseCapability = NewPromiseCapability();

    promiseCapability.Resolve.call(undefined, x);

    return promiseCapability.Promise;
}

Promise.reject = function (r) {
    const promiseCapability = NewPromiseCapability();

    promiseCapability.Reject.call(undefined, r);

    return promiseCapability.Promise;
}

/**
 * 执行 promise reaction 的函数
 * @param {any} reaction reaction
 * @param {any} argument value or reason
 */
function PromiseReactionJob (reaction, argument) {
    const promiseCapability = reaction.Capability;
    const type = reaction.Type;
    const handler = reaction.Handler;

    if (handler === undefined) {
        if (type === 'Fulfill') {
            promiseCapability.Resolve.call(undefined, argument);
        } else if (type === 'Reject') {
            promiseCapability.Reject.call(undefined, argument);
        }
    } else {
        try {
            const handlerResult = handler.call(undefined, argument);
            promiseCapability.Resolve.call(undefined, handlerResult);
        } catch (error) {
            promiseCapability.Reject.call(undefined, error);
        }
    }
}

function PromiseResolveThenableJob (promise, resolution, thenAction) {
    const resolvingFunctions = CreateResolvingFunctions(promise);
    try {
        return thenAction.call(resolution, resolvingFunctions.Resolve, resolvingFunctions.Reject);
    } catch (error) {
        const status = resolvingFunctions.Reject.call(undefined, error);
        return status;
    }
}

/**
 * 包装 resolve 和 reject
 * 返回的 resolve 和 reject 是实际上状态改变触发的函数
 * @param {any} promise promise
 * @returns { resolve, reject }
 */
function CreateResolvingFunctions (promise) {
    const alreadyResolved = false;

    const resolve = getPromiseResolveFunctions();
    resolve.setPromise(promise);
    resolve.setAlreadyResolved(alreadyResolved);

    const reject = getPromiseRejectFunctions();
    reject.setPromise(promise);
    reject.setAlreadyResolved(alreadyResolved);

    return {
        Resolve: resolve.Function,
        Reject: reject.Function
    }
}

function getPromiseResolveFunctions () {
    let Promise;
    let AlreadyResolved;
    return {
        setPromise: (value) => (Promise = value),
        setAlreadyResolved: (value) => (AlreadyResolved = value),
        Function: function (resolution) {
            const promise = Promise;
            const alreadyResolved = AlreadyResolved;

            if (alreadyResolved) {
                return;
            }

            AlreadyResolved = true;

            if (resolution === promise) {
                const selfResolutionError = new TypeError('resolution === promise');
                return RejectPromise(promise, selfResolutionError);
            }

            if (!isObject(resolution)) {
                return FulfillPromise(promise, resolution);
            }

            const thenAction = resolution.then;

            if (!isCallable(thenAction)) {
                return FulfillPromise(promise, resolution);
            }

            setImmediate(function () {
                PromiseResolveThenableJob(promise, resolution, thenAction)
            });
        }
    }
}

function getPromiseRejectFunctions () {
    let Promise;
    let AlreadyResolved;
    return {
        setPromise: (value) => (Promise = value),
        setAlreadyResolved: (value) => (AlreadyResolved = value),
        Function: function (reason) {
            const promise = Promise;
            const alreadyResolved = AlreadyResolved;

            if (alreadyResolved) {
                return undefined;
            }

            AlreadyResolved = true;

            return RejectPromise(promise, reason);
        }
    }
}

function FulfillPromise (promise, value) {
    const reactions = promise.PromiseFulfillReactions;
    promise.PromiseResult = value;
    promise.PromiseFulfillReactions = undefined;
    promise.PromiseRejectReactions = undefined;
    promise.PromiseState = 'fulfilled';

    return TriggerPromiseReactions(reactions, value);
}

function RejectPromise (promise, reason) {
    const reactions = promise.PromiseRejectReactions;

    promise.PromiseResult = reason;
    promise.PromiseFulfillReactions = undefined;
    promise.PromiseRejectReactions = undefined;
    promise.PromiseState = 'rejected';

    if (!promise.PromiseIsHandled) {
        HostPromiseRejectionTracker(promise, 'reject');
    }

    return TriggerPromiseReactions(reactions, reason);
}

function HostPromiseRejectionTracker (promise, operation) {
    // do nothing
    console.log('HostPromiseRejectionTracker is invoked:', operation);
}

/**
 * 触发 promise 相应状态下的所有回调函数
 *
 * @param {any} reactions resolve callbacks
 * @param {any} argument value or reason
 */
function TriggerPromiseReactions (reactions, argument) {
    reactions.forEach(reaction => {
        setImmediate(function () {
            PromiseReactionJob(reaction, argument);
        });
    })
}

/**
 * 内部 then
 * @param {any} promise 当前 promise
 * @param {any} onFulfilled fulfilled reaction handler
 * @param {any} onRejected rejected reaction handler
 * @param {any} resultCapability 下一个 promise 的控制器
 * @returns 下一个 promise
 */
function PerformPromiseThen (promise, onFulfilled, onRejected, resultCapability) {
    if (!isCallable(onFulfilled)) {
        onFulfilled = undefined;
    }

    if (!isCallable(onRejected)) {
        onRejected = undefined;
    }

    /**
     * reaction
     * capability 下一个 promise 的控制器
     * type 类型
     * handler 当前需要执行的函数
     */
    const fulfillReaction = {
        Capability: resultCapability,
        Type: 'Fulfill',
        Handler: onFulfilled
    };

    const rejectReaction = {
        Capability: resultCapability,
        Type: 'Reject',
        Handler: onRejected
    };

    console.log('state:', promise.PromiseState);

    if (promise.PromiseState === 'pending') {
        promise.PromiseFulfillReactions.push(fulfillReaction);
        promise.PromiseRejectReactions.push(rejectReaction);
    } else if (promise.PromiseState === 'fulfilled') {
        const value = promise.PromiseResult;
        setImmediate(function () {
            PromiseReactionJob(fulfillReaction, value);
        });
    } else if (promise.PromiseState === 'rejected') {
        const reason = promise.PromiseResult;
        if (!promise.PromiseIsHandled) {
            HostPromiseRejectionTracker(promise, 'handle');
        }
        setImmediate(function () {
            PromiseReactionJob(rejectReaction, reason);
        });
    }

    promise.PromiseIsHandled = true;
    // 返回的是下一个 promise
    return resultCapability.Promise;
}

/**
 * 返回一个 promiseCapability
 * 包含
 * promise
 * resolve：控制 promise 的 resolve
 * reject：控制 promise 的 reject
 * @returns promiseCapability
 */
function NewPromiseCapability () {
    const promiseCapability = {
        Promise: undefined,
        Resolve: undefined,
        Reject: undefined
    };

    const executor = function (resolve, reject) {
        if (promiseCapability.Resolve) {
            throw new TypeError('promiseCapability.Resolve');
        }

        if (promiseCapability.Reject) {
            throw new TypeError('promiseCapability.Reject');
        }

        promiseCapability.Resolve = resolve;
        promiseCapability.Reject = reject;
    };

    promiseCapability.Promise = new Promise(executor);

    if (!isCallable(promiseCapability.Resolve)) {
        throw new TypeError('!isCallable(promiseCapability.Resolve)');
    }

    if (!isCallable(promiseCapability.Reject)) {
        throw new TypeError('!isCallable(promiseCapability.Reject)');
    }

    return promiseCapability;
}

Promise.deferred = function () {
    const {
        Resolve,
        Reject,
        Promise
    } = NewPromiseCapability();

    return {
        resolve: Resolve,
        reject: Reject,
        promise: Promise
    }
}

module.exports = Promise;
