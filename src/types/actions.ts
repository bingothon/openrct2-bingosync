export enum ClientActions {
    /** First message of a plugin connection: { serverId } */
    HELLO = 'hello',
    START = 'start',
    STOP = 'stop',
    RESTART = 'restart',
    CONNECT_OR_CREATE = 'connectOrCreate',
    SELECT_GOAL = 'selectGoal',
}
