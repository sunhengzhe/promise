const isCallable = require('is-callable');

function isObject (obj) {
    return typeof obj === 'object';
}

function isFunction (func) {
    return typeof func === 'function';
}

function isPromise (promise) {
    return promise instanceof Promise;
}

const PROMISE_STATE = {
    PENDING: 'pending',
    FULFILLED: 'fulfilled',
    REJECTED: 'rejected'
};

const REACTION_TYPE = {
    FULFILL: 'Fulfill',
    REJECT: 'Reject'
};

function Promise (executor) {
    if (!new.target) {
        throw new TypeError('undefined is not a promise');
    }

    if (!isCallable(executor)) {
        throw new TypeError(`Promise resolver ${executor} is not a function`);
    }

    const promise = Object.create(new.target.prototype, {
        '[[PromiseState]]': {
            value: PROMISE_STATE.PENDING,
            writable: true
        },
        '[[PromiseFulfillReactions]]': {
            value: []
        },
        '[[PromiseRejectReactions]]': {
            value: []
        },
        '[[PromiseIsHandled]]': {
            value: false,
            writable: true
        }
    });

    const resolvingFunctions = createResolvingFunctions(promise);

    try {
        executor(resolvingFunctions.resolve, resolvingFunctions.reject);
    } catch (err) {
        resolvingFunctions.reject(err);
    }

    return promise;
}

/**
 * 包装 resolve 和 reject
 * 返回的 resolve 和 reject 是实际上状态改变触发的函数
 * @param {any} promise promise
 * @returns { resolve, reject }
 */
function createResolvingFunctions (promise) {
    let alreadySettled = false;

    const resolve = function (resolution) {
        if (alreadySettled) {
            return;
        }

        alreadySettled = true;

        if (resolution === promise) {
            const selfResolutionError = new TypeError('resolution === promise');
            return rejectPromise(promise, selfResolutionError);
        }

        if (resolution === null) {
            return fulfillPromise(promise, resolution);
        }

        if (!isObject(resolution) && !isFunction(resolution)) {
            return fulfillPromise(promise, resolution);
        }

        try {
            const thenAction = resolution.then;

            if (!isCallable(thenAction)) {
                return fulfillPromise(promise, resolution);
            }

            setImmediate(function () {
                promiseResolveThenableJob(promise, resolution, thenAction)
            });
        } catch (error) {
            return rejectPromise(promise, error);
        }
    };

    const reject = function (reason) {
        if (alreadySettled) {
            return;
        }

        alreadySettled = true;

        return rejectPromise(promise, reason);
    }

    return {
        resolve,
        reject
    }
}

function fulfillPromise (promise, value) {
    if (promise['[[PromiseState]]'] !== PROMISE_STATE.PENDING) {
        return;
    }

    const reactions = promise['[[PromiseFulfillReactions]]'];

    promise['[[PromiseResult]]'] = value;
    promise['[[PromiseFulfillReactions]]'] = undefined;
    promise['[[PromiseRejectReactions]]'] = undefined;
    promise['[[PromiseState]]'] = PROMISE_STATE.FULFILLED;

    return triggerPromiseReactions(reactions, value);
}

function rejectPromise (promise, reason) {
    if (promise['[[PromiseState]]'] !== PROMISE_STATE.PENDING) {
        return;
    }

    const reactions = promise['[[PromiseRejectReactions]]'];

    promise['[[PromiseResult]]'] = reason;
    promise['[[PromiseFulfillReactions]]'] = undefined;
    promise['[[PromiseRejectReactions]]'] = undefined;
    promise['[[PromiseState]]'] = PROMISE_STATE.REJECTED;

    // if (!promise['[[PromiseIsHandled]]']) {
    //     // HostPromiseRejectionTracker(promise, 'reject');
    // }

    return triggerPromiseReactions(reactions, reason);
}

/**
 * 触发 promise 相应状态下的所有回调函数
 *
 * @param {any} reactions resolve callbacks
 * @param {any} argument value or reason
 */
function triggerPromiseReactions (reactions, argument) {
    reactions.forEach(reaction => {
        setImmediate(function () {
            promiseReactionJob(reaction, argument);
        });
    })
}

/**
 * 执行 promise reaction 的函数
 * @param {any} reaction reaction
 * @param {any} argument value or reason
 */
function promiseReactionJob (reaction, argument) {
    const {
        capability,
        type,
        handler
    } = reaction;

    if (!handler) {
        if (type === REACTION_TYPE.FULFILL) {
            capability.resolve(argument);
        } else if (type === REACTION_TYPE.REJECT) {
            capability.reject(argument);
        }
    } else {
        try {
            const handlerResult = handler(argument);
            capability.resolve(handlerResult);
        } catch (error) {
            capability.reject(error);
        }
    }
}

/**
 * 执行 thenable 的 then 方法
 *
 * @param {any} promise
 * @param {any} thenable
 * @param {any} then
 * @returns
 */
function promiseResolveThenableJob (promise, thenable, then) {
    const resolvingFunctions = createResolvingFunctions(promise);
    try {
        return then.call(thenable, resolvingFunctions.resolve, resolvingFunctions.reject);
    } catch (error) {
        return resolvingFunctions.reject(error);
    }
}

Promise.prototype.then = function (onFulfilled, onRejected) {
    const promise = this;
    if (!isPromise(promise)) {
        throw new TypeError('!IsPromise(promise)');
    }

    // 创建一个新的 promise 用于 promise chain 的后续执行
    const resultCapability = newPromiseCapability();
    return performPromiseThen(promise, onFulfilled, onRejected, resultCapability);
}

/**
 * 返回一个 promiseCapability
 * 包含
 * promise
 * resolve：控制 promise 的 resolve
 * reject：控制 promise 的 reject
 * @returns promiseCapability
 */
function newPromiseCapability () {
    const promiseCapability = {
        promise: undefined,
        resolve: undefined,
        reject: undefined
    };

    const executor = function (resolve, reject) {
        if (promiseCapability.resolve) {
            throw new TypeError('promiseCapability.Resolve');
        }

        if (promiseCapability.reject) {
            throw new TypeError('promiseCapability.Reject');
        }

        promiseCapability.resolve = resolve;
        promiseCapability.reject = reject;
    };

    promiseCapability.promise = new Promise(executor);

    if (!isCallable(promiseCapability.resolve)) {
        throw new TypeError('!isCallable(promiseCapability.Resolve)');
    }

    if (!isCallable(promiseCapability.reject)) {
        throw new TypeError('!isCallable(promiseCapability.Reject)');
    }

    return promiseCapability;
}

/**
 * 内部 then
 * @param {any} promise 当前 promise
 * @param {any} onFulfilled fulfilled reaction handler
 * @param {any} onRejected rejected reaction handler
 * @param {any} resultCapability 下一个 promise 的控制器
 * @returns 下一个 promise
 */
function performPromiseThen (promise, onFulfilled, onRejected, resultCapability) {
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
        capability: resultCapability,
        type: REACTION_TYPE.FULFILL,
        handler: onFulfilled
    };

    const rejectReaction = {
        capability: resultCapability,
        type: REACTION_TYPE.REJECT,
        handler: onRejected
    };

    if (promise['[[PromiseState]]'] === PROMISE_STATE.PENDING) {
        promise['[[PromiseFulfillReactions]]'].push(fulfillReaction);
        promise['[[PromiseRejectReactions]]'].push(rejectReaction);
    } else if (promise['[[PromiseState]]'] === PROMISE_STATE.FULFILLED) {
        const value = promise['[[PromiseResult]]'];
        setImmediate(function () {
            promiseReactionJob(fulfillReaction, value);
        });
    } else if (promise['[[PromiseState]]'] === PROMISE_STATE.REJECTED) {
        const reason = promise['[[PromiseResult]]'];
        setImmediate(function () {
            promiseReactionJob(rejectReaction, reason);
        });
    }

    promise.PromiseIsHandled = true;
    // 返回的是下一个 promise
    return resultCapability.promise;
}

Promise.resolve = function (x) {
    const promiseCapability = newPromiseCapability();

    promiseCapability.resolve(x);

    return promiseCapability.promise;
}

Promise.reject = function (r) {
    const promiseCapability = newPromiseCapability();

    promiseCapability.reject(r);

    return promiseCapability.promise;
}

Promise.deferred = newPromiseCapability;

module.exports = Promise;
