// Shared type definitions
export type ValueType = 'string' | 'number' | 'boolean' | 'object';
export type ValueOf<T extends ValueType> = T extends 'string' ? string : T extends 'number' ? number : T extends 'boolean' ? boolean : object;
