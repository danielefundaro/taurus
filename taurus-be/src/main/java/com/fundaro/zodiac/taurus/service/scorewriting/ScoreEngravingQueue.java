package com.fundaro.zodiac.taurus.service.scorewriting;

import com.fundaro.zodiac.taurus.config.RabbitMQConfig;
import com.fundaro.zodiac.taurus.config.ScoreEngravingQueueConfiguration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;

/**
 * Publishes engraving jobs once their transaction commits. A message that cannot be published is not an error: the job
 * stays queued and the recovery scheduler publishes it again.
 */
@Component
public class ScoreEngravingQueue {

    private static final Logger log = LoggerFactory.getLogger(ScoreEngravingQueue.class);

    private final RabbitTemplate rabbitTemplate;
    private final ObjectMapper objectMapper;

    public ScoreEngravingQueue(RabbitTemplate rabbitTemplate, ObjectMapper objectMapper) {
        this.rabbitTemplate = rabbitTemplate;
        this.objectMapper = objectMapper;
    }

    /** The message of a job, as read by the listener. */
    public record JobMessage(String tenant, Long jobId) {}

    public void publishAfterCommit(String tenant, Long jobId) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    publish(tenant, jobId);
                }
            });
        } else {
            publish(tenant, jobId);
        }
    }

    public JobMessage read(Message message) throws IOException {
        return objectMapper.readValue(message.getBody(), JobMessage.class);
    }

    private void publish(String tenant, Long jobId) {
        try {
            Message message = MessageBuilder.withBody(objectMapper.writeValueAsBytes(new JobMessage(tenant, jobId)))
                .setContentType(MessageProperties.CONTENT_TYPE_JSON)
                .build();
            rabbitTemplate.send(RabbitMQConfig.topicExchangeName, ScoreEngravingQueueConfiguration.QUEUE, message);
        } catch (AmqpException | JacksonException exception) {
            log.warn("Engraving job {} of tenant {} not published, it will be retried: {}", jobId, tenant, exception.getMessage());
        }
    }
}
