import {dequal} from "dequal"
import {useDebugValue, useRef, useState} from "react"
import useIsomorphicLayoutEffect from "use-isomorphic-layout-effect"
import {
  DefaultContext,
  EventObject,
  Interpreter,
  PayloadSender,
  State,
  StateFrom,
  StateMachine,
  StateSchema,
} from "xstate"

type ContextFrom<T extends StateMachine<any, any, any>> =
  T extends StateMachine<infer TContext, any, any> ? TContext : never
type StateSchemaFrom<T extends StateMachine<any, any, any>> =
  T extends StateMachine<any, infer TStateSchema, any> ? TStateSchema : never
type EventFrom<T extends StateMachine<any, any, any>> = T extends StateMachine<
  any,
  any,
  infer TEvent
>
  ? TEvent
  : never

export interface UseActorAmplifiedReturnType<
  T extends StateMachine<any, any, any>,
> {
  state: StateFrom<T>
  send: PayloadSender<EventFrom<T>>
  service:
    | Interpreter<ContextFrom<T>, StateSchemaFrom<T>, EventFrom<T>>
    | undefined
}

// This hook is quite shamelessly copied from @xstate/react
const useConstant = <T extends any>(fn: () => T): T => {
  const ref = useRef<{c: T}>()
  if (ref.current == null) {
    ref.current = {c: fn()}
  }
  return ref.current.c
}

const useActorAmplified = <
  TContext = DefaultContext,
  TStateSchema extends StateSchema = any,
  TEvent extends EventObject = EventObject,
>(
  src: StateMachine<TContext, TStateSchema, TEvent>,
  actor: Interpreter<TContext, TStateSchema, TEvent> | undefined,
  linger = true,
): {
  state: State<TContext, TEvent>
  send: PayloadSender<TEvent>
  service: Interpreter<TContext, TStateSchema, TEvent> | undefined
} => {
  const actorRef = useRef<
    Interpreter<TContext, TStateSchema, TEvent> | undefined
  >(actor)
  const deferredSendsRef = useRef<Array<Parameters<PayloadSender<TEvent>>>>([])
  const allStateUpdatesRef = useRef(false)
  const stateRef = useRef(actor?.state ?? src.initialState)
  const [, setState] = useState(stateRef.current)
  const send: PayloadSender<TEvent> = useConstant<any>(
    () =>
      (...args: Parameters<PayloadSender<TEvent>>) => {
        const currentActor = actorRef.current
        if (currentActor == null || !currentActor.initialized) {
          deferredSendsRef.current.push(args)
        } else if (currentActor.state.done !== true) {
          currentActor.send(...args)
        }
      },
  )
  const setStateIfNecessary = useConstant(
    () => (updatedState: State<TContext, TEvent>) => {
      const currentState = stateRef.current
      if (
        allStateUpdatesRef.current ||
        !dequal(
          Object.keys(currentState.children),
          Object.keys(updatedState.children),
        )
      ) {
        stateRef.current = updatedState
        setState(updatedState)
      }
    },
  )
  useIsomorphicLayoutEffect(() => {
    if (actor != null) {
      if (actor.initialized && actor.state.done !== true) {
        while (deferredSendsRef.current.length > 0) {
          const deferredSend = deferredSendsRef.current.shift()!
          actor.send(...deferredSend)
        }
      }
      actorRef.current = actor
      setStateIfNecessary(actor.state)
      const subscription = actor.subscribe((updatedState) =>
        setStateIfNecessary(updatedState),
      )
      return () => subscription.unsubscribe()
    } else if (!linger) {
      actorRef.current = undefined
      setStateIfNecessary(src.initialState)
    }
  }, [actor, linger])
  useDebugValue(stateRef.current)
  return {
    get state() {
      allStateUpdatesRef.current = true
      return actorRef.current?.state ?? stateRef.current
    },
    send,
    service: actorRef.current,
  }
}

export default useActorAmplified
