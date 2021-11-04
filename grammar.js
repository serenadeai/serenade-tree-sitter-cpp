const C = require("tree-sitter-c/grammar")

const PREC = Object.assign(C.PREC, {
  LAMBDA: 18,
  NEW: C.PREC.CALL + 1,
  STRUCTURED_BINDING: -1,
})

module.exports = grammar(C, {
  name: 'cpp',

  externals: $ => [
    $.raw_string_literal
  ],

  conflicts: ($, original) => original.concat([
    [$.template_function, $.template_type],
    [$.template_function, $.template_type, $.expression_],
    [$.template_function, $.expression_],
    [$.template_method, $.template_type, $.field_expression],
    [$.scoped_type_identifier, $.scoped_identifier],
    [$.scoped_type_identifier, $.scoped_field_identifier],
    [$.comma_expression, $.initializer_list],
    [$.expression_, $._declarator],
    [$.expression_, $.structured_binding_declarator],
    [$.expression_, $._declarator, $._type_specifier],
    [$.parameter_list_block, $.argument_list_block],
    [$._type_specifier, $.call_expression],
    [$.declaration_specifier, $.operator_cast_declaration, $.operator_cast_definition, $.constructor_or_destructor_definition],
    [$.declaration_specifier, $.constructor_specifiers],

    [$.extends_type], 
    [$.base_class_clause], 
  ]),

  inline: ($, original) => original.concat([
    $._namespace_identifier,
  ]),

  rules: {
    top_level_item: ($, original) => field('statement', choice(
      original,
      $.namespace,
      $.using_declaration,
      $.alias_declaration,
      $.static_assert_declaration,
      $.template_declaration,
      $.template_instantiation,
      $.constructor_or_destructor_definition,
      $.operator_cast_definition,
      $.operator_cast_declaration,
    )),

    // Types

    decltype: $ => seq(
      'decltype',
      '(',
      $.expression_,
      ')',
    ),

    _type_specifier: $ => choice(
      $.struct_specifier,
      $.union_specifier,
      $.enum,
      $.class_specifier,
      $.sized_type_specifier,
      $.primitive_type,
      $.template_type,
      $.auto,
      $.dependent_type,
      $.decltype,
      prec.right(choice(
        $.scoped_type_identifier,
        $._type_identifier
      ))
    ),

    type_qualifier: ($, original) => field('modifier', choice(
      original,
      'mutable',
      'constexpr'
    )),

    constexpr_modifier: $ => field('modifier', 'constexpr'),

    // When used in a trailing return type, these specifiers can now occur immediately before
    // a compound statement. This introduces a shift/reduce conflict that needs to be resolved
    // with an associativity.
    class_specifier: $ => prec.right(seq(
      'class',
      optional($.ms_declspec_modifier),
      optional(field('name', $._class_name)), 
      optional_with_placeholder('modifier_list', $.virtual_specifier),
      optional_with_placeholder('extends_list_optional', $.base_class_clause),
      optional(field('enclosed_body', $.field_declaration_list))
    )),

    union_specifier: $ => prec.right(seq(
      'union',
      optional($.ms_declspec_modifier),
      optional(field('name', $._class_name)), 
      optional_with_placeholder('modifier_list', $.virtual_specifier),
      optional_with_placeholder('extends_list_optional', $.base_class_clause),
      optional(field('enclosed_body', $.field_declaration_list)) 
    )),

    struct_specifier: $ => prec.right(seq(
      'struct',
      optional($.ms_declspec_modifier),
      optional(field('name', $._class_name)), 
      optional_with_placeholder('modifier_list', $.virtual_specifier),
      optional_with_placeholder('extends_list_optional', $.base_class_clause),
      optional(field('enclosed_body', $.field_declaration_list))
    )),

    _class_name: $ => prec.right(choice(
      $._type_identifier,
      $.scoped_type_identifier,
      $.template_type
    )),

    declaration_specifiers: $ => seq(
      optional_with_placeholder('modifier_list', seq(
        // Serenade: We don't need virtual everywhere, but it's easier to just include here.
        optional($.virtual_function_specifier), 
        repeat($.declaration_specifier)
      )),
      field('type', $._type_specifier),
      optional_with_placeholder('modifier_list', repeat($.declaration_specifier)),
    ),

    virtual_specifier: $ => field('modifier', choice(
      'final', // the only legal value here for classes
      'override' // legal for functions in addition to final, plus permutations.
    )),

    virtual_function_specifier: $ => field('modifier', choice(
      'virtual'
    )),

    explicit_function_specifier: $ => choice(
      'explicit',
      prec(PREC.CALL, seq(
        'explicit',
        '(',
        $.expression_,
        ')'
      ))
    ),

    base_class_clause: $ => seq(
      ':',
      field('extends_list', commaSep1($.extends_type))
    ),

    extends_type: $ => seq(
      optional(choice('public', 'private', 'protected')),
      $._class_name,
      optional('...')
    ),

    enum: $ => prec.left(seq(
      'enum',
      optional(choice('class', 'struct')),
      choice(
        seq(
          field('name', $._class_name),
          optional_with_placeholder('extends_optional', $.enum_base_clause),
          optional(field('enclosed_body', $.enumerator_list_block))
        ),
        field('enclosed_body', $.enumerator_list_block)
      )
    )),

    // field('extends_list', commaSep1($.extends_type))

    enum_base_clause: $ => prec.left(seq(
      ':',
      field('extends_type', choice($.scoped_type_identifier, $._type_identifier, $.sized_type_specifier))
    )),

    // The `auto` storage class is removed in C++0x in order to allow for the `auto` type.
    storage_class_specifier: $ => field('modifier', choice(
      'extern',
      'static',
      'register',
      'inline'
    )),

    auto: $ => 'auto',

    dependent_type: $ => prec.dynamic(-1, seq(
      'typename',
      $._type_specifier
    )),

    // Declarations

    function_definition: ($, original) => seq(
      repeat($.attribute),
      original
    ),

    declaration_without_semicolon: ($, original) => seq(
      repeat($.attribute),
      original
    ),

    template_declaration: $ => seq(
      'template',
      field('parameters', $.template_parameter_list),
      choice(
        $.empty_declaration,
        $.alias_declaration,
        alias($.declaration, $.field_declaration), // TODO: Not sure if this works well or is necessary.
        $.template_declaration,
        $.function_definition,
        $.constructor_or_destructor_declaration,
        $.constructor_or_destructor_definition,
        $.operator_cast_declaration,
        $.operator_cast_definition,
      )
    ),

    template_instantiation: $ => seq(
      'template',
      optional($.declaration_specifiers),
      field('declarator', $._declarator),
      ';'
    ),

    template_parameter_list: $ => seq(
      '<',
      commaSep(choice(
        $.parameter_declaration,
        $.optional_parameter_declaration,
        $.type_parameter_declaration,
        $.variadic_parameter_declaration,
        $.variadic_type_parameter_declaration,
        $.optional_type_parameter_declaration,
        $.template_template_parameter_declaration
      )),
      alias(token(prec(1, '>')), '>')
    ),

    parameter_declaration: ($, original) => seq(
      repeat($.attribute),
      original
    ),

    type_parameter_declaration: $ => prec(1, seq(
      choice('typename', 'class'),
      optional($._type_identifier)
    )),

    variadic_type_parameter_declaration: $ => prec(1, seq(
      choice('typename', 'class'),
      '...',
      optional($._type_identifier)
    )),

    optional_type_parameter_declaration: $ => seq(
      choice('typename', 'class'),
      optional(field('name', $._type_identifier)),
      '=',
      field('default_type', $._type_specifier)
    ),

    template_template_parameter_declaration: $ => seq(
      'template',
      field('parameters', $.template_parameter_list),
      choice(
        $.type_parameter_declaration,
        $.variadic_type_parameter_declaration,
        $.optional_type_parameter_declaration
      )
    ),

    parameter_list: $ => commaSep1(
      field('parameter', choice(
        $.parameter_declaration,
        $.optional_parameter_declaration,
        $.variadic_parameter_declaration,
        '...'
      ))
    ),

    optional_parameter_declaration: $ => seq(
      $.declaration_specifiers,
      optional(field('declarator', $._declarator)),
      '=',
      field('parameter_value', $.expression_)
    ),

    variadic_parameter_declaration: $ => seq(
      $.declaration_specifiers,
      field('declarator', choice(
        $.variadic_declarator,
        alias($.variadic_reference_declarator, $.reference_declarator)
      ))
    ),

    variadic_declarator: $ => seq(
      '...',
      optional($.identifier)
    ),

    variadic_reference_declarator: $ => seq(
      choice('&&', '&'),
      $.variadic_declarator
    ),

    init_list_declarator: $ => seq(
      field('assignment_variable', $._declarator),
      field('assignment_value', choice(
        $.argument_list_block,
        $.initializer_list
      ))
    ),

    init_declarator: ($, original) => choice(
      original,
      $.init_list_declarator
    ),

    operator_cast: $ => prec(1, seq(
      optional(seq(
        optional(field('namespace', choice(
          $._namespace_identifier,
          $.template_type,
          $.scoped_namespace_identifier
        ))),
        '::',
      )),
      'operator',
      $.declaration_specifiers,
      field('declarator', $._abstract_declarator),
    )),

    // Avoid ambiguity between compound statement and initializer list in a construct like:
    //   A b {};
    enclosed_body: ($, original) => prec(-1, original),

    field_initializer_list: $ => seq(
      ':',
      commaSep1($.field_initializer)
    ),

    field_initializer: $ => prec(1, seq(
      choice($._field_identifier, $.scoped_field_identifier),
      choice($.initializer_list, $.argument_list_block),
      optional('...')
    )),

    field_declaration_list_item_: ($, original) => choice(
      original,
      $.template_declaration,
      $.inline_method_definition,
      $.constructor_or_destructor_definition,
      $.constructor_or_destructor_declaration,
      $.operator_cast_definition,
      $.operator_cast_declaration,
      $.friend_declaration,
      $.access_specifier,
      $.alias_declaration,
      $.using_declaration,
      $.type_definition,
      $.static_assert_declaration
    ),

    field_declaration: $ => seq(
      repeat($.attribute),
      // optional($.virtual_function_specifier),
      $.declaration_specifiers,
      $.field_declaration_maybe_assignment, 
      ';'
    ),

    // TODO: Check if we can make this a commaSep1...
    // if not, make this field optional in declaration..
    field_declaration_maybe_assignment: $ => seq(
      field('maybe_assignment_variable_list', commaSep1(alias($.field_declarator, $.maybe_assignment_variable))),
      optional_with_placeholder('assignment_value_list_optional', $.field_declaration_assignment_value),
    ),

    field_declaration_assignment_value: $ => choice(
      $.bitfield_clause,
      field('assignment_value', $.initializer_list),
      seq('=', field('assignment_value', choice($.expression_, $.initializer_list)))
    ), 

    inline_method_definition: $ => seq(
      repeat($.attribute),
      // optional($.virtual_function_specifier),
      $.declaration_specifiers,
      field('declarator', $.field_declarator),
      choice(
        field('body', $.enclosed_body),
        $.default_method_clause,
        $.delete_method_clause
      )
    ),

    constructor_specifiers: $ => repeat1(
      prec.right(choice(
        $.storage_class_specifier,
        $.type_qualifier,
        $.attribute_specifier,
        $.virtual_function_specifier,
        $.explicit_function_specifier
      ))
    ),

    operator_cast_definition: $ => seq(
      optional_with_placeholder('modifier_list', $.constructor_specifiers),
      field('declarator', $.operator_cast),
      choice(
        field('body', $.enclosed_body),
        $.default_method_clause,
        $.delete_method_clause
      )
    ),

    operator_cast_declaration: $ => prec(1, seq(
      optional_with_placeholder('modifier_list', $.constructor_specifiers),
      field('declarator', $.operator_cast),
      optional(seq('=', field('default_value', $.expression_))),
      ';'
    )),

    constructor_or_destructor_definition: $ => seq(
      optional_with_placeholder('modifier_list', $.constructor_specifiers),
      field('declarator', $.function_declarator),
      optional($.field_initializer_list),
      choice(
        field('body', $.enclosed_body),
        $.default_method_clause,
        $.delete_method_clause
      )
    ),

    constructor_or_destructor_declaration: $ => seq(
      optional_with_placeholder('modifier_list', $.constructor_specifiers),
      field('declarator', $.function_declarator),
      ';'
    ),

    default_method_clause: $ => seq('=', 'default', ';'),
    delete_method_clause: $ => seq('=', 'delete', ';'),

    friend_declaration: $ => seq(
      'friend',
      choice(
        $.declaration,
        $.function_definition,
        seq(
          optional(choice(
            'class',
            'struct',
            'union'
          )),
          $._class_name, ';'
        )
      )
    ),

    access_specifier: $ => seq(
      choice(
        'public',
        'private',
        'protected'
      ),
      ':'
    ),

    _declarator: ($, original) => choice(
      original,
      $.reference_declarator,
      $.scoped_identifier,
      $.template_function,
      $.operator_name,
      $.destructor_name,
      $.structured_binding_declarator
    ),

    field_declarator: ($, original) => choice(
      original,
      $.reference_field_declarator,
      $.template_method,
      $.operator_name
    ),

    _abstract_declarator: ($, original) => choice(
      original,
      $.abstract_reference_declarator
    ),

    reference_declarator: $ => prec.dynamic(1, prec.right(seq(choice('&', '&&'), $._declarator))),
    reference_field_declarator: $ => prec.dynamic(1, prec.right(seq(choice('&', '&&'), $.field_declarator))),
    abstract_reference_declarator: $ => prec.right(seq(choice('&', '&&'), optional($._abstract_declarator))),

    structured_binding_declarator: $ => prec.dynamic(PREC.STRUCTURED_BINDING, seq(
      '[', commaSep1($.identifier), ']'
    )),

    // serenade note: Moved trailing return type out of the function modifier list. 
    // not sure if it's technically allowed to have these in any order, or if this
    // was just a simplification to the grammar. Also don't allow repeated 
    // trailing return type. 
    function_declarator: ($, original) => prec.dynamic(1, seq(
      field('identifier', $._declarator),
      field('parameters', $.parameter_list_block),
      // optional_with_placeholder('modifier_list', repeat($.attribute_specifier)),,
      optional_with_placeholder('function_modifier_list',
        repeat(choice(
          $.attribute_specifier,
          $.type_qualifier,
          $.virtual_specifier,
          $.noexcept,
          $.throw_specifier
      ))), 
      optional_with_placeholder('return_type_optional', $.trailing_return_type)
    )),

    function_field_declarator: ($, original) => prec.dynamic(1, seq(
      original,
      optional_with_placeholder('function_modifier_list',
        repeat(choice(
          $.type_qualifier,
          $.virtual_specifier,
          $.noexcept,
          $.throw_specifier
      ))), 
      optional_with_placeholder('return_type_optional', $.trailing_return_type)
    )),

    abstract_function_declarator: ($, original) => prec.right(seq(
      original,
      optional_with_placeholder('function_modifier_list',
        repeat(choice(
          $.type_qualifier,
          $.noexcept,
          $.throw_specifier
      ))),
      optional_with_placeholder('return_type_optional', $.trailing_return_type)
    )),

    trailing_return_type: $ => prec.right(seq(
      '->',
      field('return_type', seq(
        optional($.type_qualifier),
        $._type_specifier,
        optional($._abstract_declarator)
      ))
    )),

    noexcept: $ => field('modifier', prec.right(seq(
      'noexcept',
      optional(
        seq(
          '(',
          optional($.expression_),
          ')',
        ),
      ),
    ))),

    throw_specifier: $ => seq(
      'throw',
      seq(
        '(',
        commaSep($.type_descriptor),
        ')',
      )
    ),

    template_type: $ => seq(
      field('name', choice($._type_identifier, $.scoped_type_identifier)),
      field('arguments', $.template_argument_list)
    ),

    template_method: $ => seq(
      field('name', choice($._field_identifier, $.scoped_field_identifier)),
      field('arguments', $.template_argument_list)
    ),

    template_function: $ => seq(
      field('name', choice($.identifier, $.scoped_identifier)),
      field('arguments', $.template_argument_list)
    ),

    template_argument_list: $ => seq(
      '<',
      commaSep(choice(
        prec.dynamic(3, $.type_descriptor),
        prec.dynamic(2, alias($.type_parameter_pack_expansion, $.parameter_pack_expansion)),
        prec.dynamic(1, $.expression_)
      )),
      alias(token(prec(1, '>')), '>')
    ),

    namespace: $ => seq(
      'namespace',
      optional(field('name', $.identifier)),
      field('enclosed_body', $.declaration_list)
    ),

    using_declaration: $ => seq(
      'using',
      optional('namespace'),
      choice(
        $.identifier,
        $.scoped_identifier
      ),
      ';'
    ),

    alias_declaration: $ => seq(
      'using',
      field('name', $._type_identifier),
      '=',
      field('type', $.type_descriptor),
      ';'
    ),

    static_assert_declaration: $ => seq(
      'static_assert',
      '(',
      field('condition', $.expression_),
      optional(seq(
        ',',
        field('message', choice(
          $.string_literal,
          $.raw_string_literal,
          $.concatenated_string,
        ))
      )),
      ')',
      ';'
    ),

    // Statements

    statement: ($, original) => choice(
      original,
      $.try,
      $.throw,
    ),

    // If statement has constexpr which is new. 

    if_clause: $ => prec.dynamic(0, seq(
      'if', 
      optional_with_placeholder('modifier_list', $.constexpr_modifier), 
      '(', 
      $.condition, 
      ')', 
      $.statement),
    ),

    else_if_clause: $ => prec.dynamic(1, seq(
      'else', 'if', 
      optional_with_placeholder('modifier_list', $.constexpr_modifier),
      '(', 
      $.condition, 
      ')', 
      $.statement
    )), 

    condition: $ => seq(
      choice(
        seq(
          optional(field('initializer', choice(
            $.declaration,
            $.expression_statement
          ))),
          field('value', choice(
            $.expression_,
            $.comma_expression
          )),
        ),
        field('value', $.condition_declaration)
      ),
    ),

    condition_declaration: $ => seq(
      $.declaration_specifiers,
      field('declarator', $._declarator),
      choice(
        seq(
          '=',
          field('value', $.expression_),
        ),
        field('value', $.initializer_list),
      )
    ),

    for: ($, original) => choice(
      original, 
      $.for_each_clause
    ),

    for_each_clause: $ => seq(
      'for',
      '(',
      field('block_iterator', seq($.declaration_specifiers, $._declarator)),
      ':',
      field('block_collection', choice(
        $.expression_,
        $.initializer_list,
      )),
      ')',
      field('body', $.statement)
    ),

    return_value: ($, original) => choice(
      original, 
      $.initializer_list
    ),

    throw: $ => seq(
      'throw',
      optional($.expression_),
      ';'
    ),
    
    try: $ => seq(
      $.try_clause,
      field('catch_list', repeat1($.catch)), 
      optional_with_placeholder("finally_clause_optional", "!!UNMATCHABLE_4b0fd36954db") // Here for Spec purposes. 
    ),

    try_clause: $ => seq(
      'try', 
      $.enclosed_body
    ), 

    catch_parameter_block: $ => seq(
      '(',
      alias($.parameter_list, $.catch_parameter),
      ')'
    ),

    catch: $ => seq(
      'catch',
      field('catch_parameter_optional', $.catch_parameter_block),
      $.enclosed_body
    ),

    attribute: $ => seq(
      '[[',
      commaSep1($.expression_),
      ']]'
    ),

    // Expressions

    expression_: ($, original) => choice(
      original,
      $.template_function,
      $.scoped_identifier,
      $.new_expression,
      $.delete_expression,
      $.lambda,
      $.parameter_pack_expansion,
      $.nullptr,
      $.this,
      $.raw_string_literal
    ),

    call_expression: ($, original) => choice(original, seq(
      field('function_', $.primitive_type),
      field('arguments', $.argument_list_block)
    )),

    new_expression: $ => prec.right(PREC.NEW, seq(
      optional('::'),
      'new',
      optional(field('placement', $.argument_list_block)),
      field('type', $._type_specifier),
      optional(field('declarator', $.new_declarator)),
      optional(field('arguments', choice(
        $.argument_list_block,
        $.initializer_list
      )))
    )),

    new_declarator: $ => prec.right(seq(
      '[',
      field('length', $.expression_),
      ']',
      optional($.new_declarator)
    )),

    delete_expression: $ => seq(
      optional('::'),
      'delete',
      optional(seq('[', ']')),
      $.expression_
    ),

    field_expression: ($, original) => choice(
      original,
      seq(
        prec(PREC.FIELD, seq(
          field('argument_', $.expression_),
          choice('.', '->')
        )),
        field('field', choice(
          $.destructor_name,
          $.template_method
        ))
      )
    ),

    lambda: $ => seq(
      field('captures', $.lambda_capture_specifier),
      optional(field('declarator', $.abstract_function_declarator)),
      field('body', $.enclosed_body)
    ),

    lambda_capture_specifier: $ => prec(PREC.LAMBDA, seq(
      '[',
      choice(
        $.lambda_default_capture,
        commaSep($.expression_),
        seq(
          $.lambda_default_capture,
          ',', commaSep1($.expression_)
        )
      ),
      ']'
    )),

    lambda_default_capture: $ => choice('=', '&'),

    parameter_pack_expansion: $ => prec(-1, seq(
      field('pattern', $.expression_),
      '...'
    )),

    type_parameter_pack_expansion: $ => seq(
      field('pattern', $.type_descriptor),
      '...'
    ),

    sizeof_expression: ($, original) => choice(
      original,
      seq(
        'sizeof', '...',
        '(',
        field('value', $.identifier),
        ')'
      ),
    ),

    argument: ($, original) => choice(original, $.initializer_list),

    destructor_name: $ => field('identifier', prec(1, seq('~', $.identifier))),

    compound_literal_expression: ($, original) => choice(
      original,
      seq(
        field('type', choice(
          $._type_identifier,
          $.template_type,
          $.scoped_type_identifier
        )),
        field('value', $.initializer_list)
      )
    ),

    scoped_field_identifier: $ => field('identifier', prec(1, seq(
      optional(choice(
        $._namespace_identifier,
        $.template_type,
        $.scoped_namespace_identifier
      )),
      '::',
      choice(
        $._field_identifier,
        $.operator_name,
        $.destructor_name
      )
    ))),

    scoped_identifier: $ => field('identifier', prec(1, seq(
      optional(choice(
        $._namespace_identifier,
        $.template_type,
        $.scoped_namespace_identifier
      )),
      '::',
      choice(
        $.identifier,
        $.operator_name,
        $.destructor_name
      )
    ))),

    scoped_type_identifier: $ => field('identifier', prec(1, seq(
      optional(choice(
        $._namespace_identifier,
        $.template_type,
        $.scoped_namespace_identifier
      )),
      '::',
      $._type_identifier
    ))),

    scoped_namespace_identifier: $ => field('identifier', prec(2, seq(
      optional(choice(
        $._namespace_identifier,
        $.template_type,
        $.scoped_namespace_identifier
      )),
      '::',
      $._namespace_identifier
    ))),

    _assignment_left_expression: ($, original) => choice(
      original,
      $.scoped_namespace_identifier,
    ),

    operator_name: $ => token(seq(
      'operator',
      choice(
        '+', '-', '*', '/', '%',
        '^', '&', '|', '~',
        '!', '=', '<', '>',
        '+=', '-=', '*=', '/=', '%=', '^=', '&=', '|=',
        '<<', '>>', '>>=', '<<=',
        '==', '!=', '<=', '>=',
        '&&', '||',
        '++', '--',
        ',',
        '->*',
        '->',
        '()', '[]'
      )
    )),

    this: $ => 'this',
    nullptr: $ => 'nullptr',

    concatenated_string: $ => seq(
      choice($.raw_string_literal, $.string_literal),
      repeat1(choice($.raw_string_literal, $.string_literal))
    ),

    _namespace_identifier: $ => alias($.identifier, $.namespace_identifier)
  }
});

function commaSep(rule) {
  return optional(commaSep1(rule));
}

function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

function optional_with_placeholder(field_name, rule) {
  return choice(field(field_name, rule), field(field_name, blank()));
}
