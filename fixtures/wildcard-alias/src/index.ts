import React from 'react'
import { SomeComponent } from 'remote-brands'  // alias via @mf-types/ — NOT a phantom
import { chunk } from 'lodash'                 // phantom: no file in @mf-types/, not declared
import { format } from 'date-fns'              // phantom: no file in @mf-types/, not declared
