import 'rxjs/add/operator/filter';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/scan';
import 'rxjs/add/operator/share';
import {Subject} from 'rxjs/Subject';
import {Observable} from 'rxjs/Observable';
import {BehaviorSubject} from 'rxjs/BehaviorSubject';
import immupdate from 'immupdate';
import * as isEqual from 'lodash.isequal';
import {CoreEvent, EventQueue} from './event-queue';
import {freeze} from './freeze';

export interface Diff {
}

export interface Updater<State> {
  (state: State): Diff;
}

export interface EventProvider<State> {
  (state: State): CoreEvent;
}

export class OperationResult<State> {
  public update: Diff;
  public event: CoreEvent;
}

export interface Operation<State> {
  (state: State): OperationResult<State>;
}

export interface CoreEventHandler<Event extends CoreEvent> {
  (event: Event): void;
}

class StateAndEvent<State> {
  public state: State;
  public event: CoreEvent;
}

export class Store<State> {

  private stateSubject: BehaviorSubject<State>;
  private eventHandlers = {};

  private operation$ = new Subject<Operation<State>>();

  constructor(private eventBus: EventQueue, initialState: State) {
    this.stateSubject = new BehaviorSubject<State>(initialState);

    eventBus.event$
      .subscribe(event => this.handleEvent(event));

    function operationReducer(previousStateAndEvent: StateAndEvent<State>, operation: Operation<State>) {
      const state = previousStateAndEvent.state;
      const result: OperationResult<State> = operation(state);
      const newStateAndEvent: StateAndEvent<State> = new StateAndEvent<State>();
      if (result && result.update) {
        const newState = immupdate(state, result.update);
        if (!isEqual(state, newState)) {
          newStateAndEvent.state = newState;
        }
      }
      if (result && result.event) {
        newStateAndEvent.event = result.event;
      }
      return newStateAndEvent;
    }

    const initialStateAndEvent: StateAndEvent<State> = {
      state: freeze(initialState),
      event: null
    };

    const stateAndEvent$: Observable<StateAndEvent<State>> = this.operation$
      .scan(operationReducer, initialStateAndEvent)
      .share();

    stateAndEvent$
      .map(stateAndEvent => stateAndEvent.state)
      .filter(Boolean)
      .map(freeze)
      .subscribe(this.stateSubject);

    stateAndEvent$
      .map(stateAndEvent => stateAndEvent.event)
      .filter(Boolean)
      .subscribe(event => eventBus.dispatch(event));

  }

  get state$(): Observable<State> {
    return this.stateSubject.asObservable();
  }

  get currentState(): State {
    return this.stateSubject.getValue();
  }

  protected on<Event extends CoreEvent>(eventType: Function, handler: CoreEventHandler<Event>) {
    this.eventHandlers[eventType.name] = handler;
  }

  protected updateState(diff: Diff) {
    this.operation$.next(state => ({
      update: diff,
      event: null
    }));
  }

  protected update(updater: Updater<State>) {
    this.operation$.next(state => ({
      update: updater(state),
      event: null
    }));
  }

  protected dispatchEvent(event: CoreEvent) {
    this.operation$.next(state => ({
      update: null,
      event
    }));
  }

  protected dispatch(eventProvider: EventProvider<State>) {
    this.operation$.next(state => ({
      update: null,
      event: eventProvider(state)
    }));
  }

  protected execute(operation: Operation<State>) {
    this.operation$.next(operation);
  }

  protected applyResult(operationResult: OperationResult<State>) {
    this.operation$.next(state => operationResult);
  }

  private handleEvent<Event extends CoreEvent>(event: Event): void {
    const handler: CoreEventHandler<Event> = this.eventHandlers[event.constructor.name];
    if (handler) {
      handler(event);
    }
  }
}
