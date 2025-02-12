{### Execute given function/procedure ###}

{% if not is_func %}
    CALL {{ func_name }} (
{% else %}
    SELECT * FROM {{ func_name }} (
{% endif %}

{% if data %}
  {% for dict_item in data %}
    {% if 'type' in dict_item and 'value' in dict_item %}
      {% if dict_item['value'] != 'NULL' and '[]' not in dict_item['type'] %}
        {{ dict_item['value']|qtLiteral }}::{{ dict_item['type'] }}{% if not loop.last %}, {% endif %}
        {% elif dict_item['value'] == 'NULL' %}
          {{ dict_item['value'] }}::{{ dict_item['type'] }}{% if not loop.last %}, {% endif %}
        {% else %}
          {% if '[]' in dict_item['type'] %}
            ARRAY[
            {% for dict_list in dict_item['value'] %}
              {% if 'value' in dict_list %}
                {{ dict_list['value']|qtLiteral }}{% if not loop.last %}, {% endif %}
              {% endif %}
            {% endfor %}
            ]::{{ dict_item['type'] }}

          {% else %} {{ dict_item['value'] }}::{{ dict_item['type'] }}
        {% endif %} {% if not loop.last %}, {% endif %}
      {% endif %}
    {% endif %}
  {% endfor %}
{% endif %}
)
